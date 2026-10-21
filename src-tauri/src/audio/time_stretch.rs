use super::source::apply_booster;
use super::state::{BoosterGain, SpeedControl};
use rodio::source::SeekError;
use rodio::Source;
use std::num::{NonZeroU16, NonZeroU32};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use wsola::TimeStretch;

const INPUT_FRAMES: usize = 1_024;
const OUTPUT_SAMPLES: usize = 4_096;
/// Adapts a decoded source to WSOLA while keeping its playback controls lock-free on the mixer.
pub(super) struct PitchPreservingSource<S> {
    inner: S,
    stretcher: TimeStretch,
    speed_control: SpeedControl,
    booster: BoosterGain,
    emitted_samples: Arc<AtomicU64>,
    real_content_started: Arc<AtomicBool>,
    underrun_signal: Option<Arc<AtomicBool>>,
    output_is_underrun: bool,
    channels: usize,
    input: Vec<f32>,
    output: Vec<f32>,
    output_pos: usize,
    output_tempo: f32,
    source_progress_fraction: f64,
    input_finished: bool,
    drained: bool,
}

impl<S: Source<Item = f32>> PitchPreservingSource<S> {
    pub(super) fn new(
        inner: S,
        speed_control: SpeedControl,
        booster: BoosterGain,
        emitted_samples: Arc<AtomicU64>,
    ) -> Result<Self, String> {
        let channels = NonZeroU16::new(inner.channels())
            .ok_or_else(|| "audio source has no channels".to_string())?;
        let sample_rate = NonZeroU32::new(inner.sample_rate())
            .ok_or_else(|| "audio source has no sample rate".to_string())?;
        let mut stretcher = TimeStretch::new(sample_rate, channels)
            .map_err(|error| format!("failed to initialize pitch-preserving playback: {error}"))?;
        let initial_speed = speed_control.get();
        stretcher.set_tempo(initial_speed);
        let channels = usize::from(channels.get());

        Ok(Self {
            inner,
            stretcher,
            speed_control,
            booster,
            emitted_samples,
            real_content_started: Arc::new(AtomicBool::new(false)),
            underrun_signal: None,
            output_is_underrun: false,
            channels,
            input: Vec::with_capacity(INPUT_FRAMES * channels),
            output: Vec::with_capacity(OUTPUT_SAMPLES),
            output_pos: 0,
            output_tempo: initial_speed,
            source_progress_fraction: 0.0,
            input_finished: false,
            drained: false,
        })
    }

    pub(super) fn real_content_started(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.real_content_started)
    }

    pub(super) fn set_underrun_signal(&mut self, underrun_signal: Arc<AtomicBool>) {
        self.underrun_signal = Some(underrun_signal);
    }

    fn refill_output(&mut self) -> bool {
        self.output.clear();
        self.output_pos = 0;
        self.output_is_underrun = false;

        while self.output.is_empty() && !self.drained {
            let buffered_output = self.stretcher.available();
            if buffered_output > 0 {
                self.output.extend(self.stretcher.pull(buffered_output));
                if !self.output.is_empty() {
                    break;
                }
            }

            let tempo = self.speed_control.get();
            self.stretcher.set_tempo(tempo);
            self.output_tempo = tempo;

            if self.input_finished {
                self.output.extend(self.stretcher.flush());
                self.drained = true;
                break;
            }

            let requested_samples = INPUT_FRAMES * self.channels;
            for _ in 0..requested_samples.saturating_sub(self.input.len()) {
                match self.inner.next() {
                    Some(sample) => {
                        self.input.push(sample);
                        if self
                            .underrun_signal
                            .as_ref()
                            .is_some_and(|flag| flag.swap(false, Ordering::AcqRel))
                        {
                            // The buffered decoder source returns one synthetic sample when its
                            // queue is empty. Keep the frame aligned and avoid counting it as
                            // playback progress; the producer continues decoding off the callback.
                            self.input.pop();
                            self.output.resize(self.channels, 0.0);
                            self.output_is_underrun = true;
                            return true;
                        }
                    }
                    None => {
                        self.input_finished = true;
                        break;
                    }
                }
            }

            let aligned_len = self.input.len() / self.channels * self.channels;
            self.input.truncate(aligned_len);
            if !self.input.is_empty() {
                self.stretcher.push(&self.input);
                self.input.clear();
            }
            self.output.extend(self.stretcher.pull(OUTPUT_SAMPLES));
        }

        !self.output.is_empty()
    }
}

impl<S: Source<Item = f32>> Iterator for PitchPreservingSource<S> {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.output_pos >= self.output.len() && !self.refill_output() {
            return None;
        }

        let sample = self.output[self.output_pos];
        self.output_pos += 1;
        if !self.output_is_underrun {
            self.real_content_started.store(true, Ordering::Release);
            self.source_progress_fraction += f64::from(self.output_tempo);
            let source_samples = self.source_progress_fraction.floor() as u64;
            self.source_progress_fraction -= source_samples as f64;
            self.emitted_samples
                .fetch_add(source_samples, Ordering::Relaxed);
        }
        Some(apply_booster(sample, self.booster.get()))
    }
}

impl<S: Source<Item = f32>> Source for PitchPreservingSource<S> {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.channels as u16
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn try_seek(&mut self, position: std::time::Duration) -> Result<(), SeekError> {
        let underlying_source = std::any::type_name::<Self>();
        let sample_rate = NonZeroU32::new(self.inner.sample_rate())
            .ok_or(SeekError::NotSupported { underlying_source })?;
        let channels = u16::try_from(self.channels)
            .ok()
            .and_then(NonZeroU16::new)
            .ok_or(SeekError::NotSupported { underlying_source })?;
        let tempo = self.speed_control.get();
        let mut stretcher = TimeStretch::new(sample_rate, channels).map_err(|error| {
            SeekError::Other(Box::new(std::io::Error::other(format!(
                "failed to reset pitch-preserving playback: {error}"
            ))))
        })?;
        stretcher.set_tempo(tempo);

        self.inner.try_seek(position)?;
        self.stretcher = stretcher;
        self.input.clear();
        self.output.clear();
        self.output_pos = 0;
        self.output_tempo = tempo;
        self.output_is_underrun = false;
        self.real_content_started.store(false, Ordering::Release);
        self.source_progress_fraction = 0.0;
        self.input_finished = false;
        self.drained = false;
        self.emitted_samples.store(0, Ordering::Relaxed);
        Ok(())
    }

    fn total_duration(&self) -> Option<std::time::Duration> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::super::source::GaplessHandoffSource;
    use super::super::state::{BoosterGain, SpeedControl};
    use super::PitchPreservingSource;
    use rodio::source::SeekError;
    use rodio::Source;
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    const SAMPLE_RATE: u32 = 44_100;
    const FREQUENCY: f32 = 440.0;
    const SPEED: f32 = 1.5;

    struct SineSource {
        cursor: usize,
        frames: usize,
        speed_control: Option<SpeedControl>,
        change_speed_at_frame: Option<usize>,
    }

    impl Iterator for SineSource {
        type Item = f32;

        fn next(&mut self) -> Option<Self::Item> {
            if self.cursor >= self.frames {
                return None;
            }
            if self.change_speed_at_frame == Some(self.cursor) {
                if let Some(speed_control) = &self.speed_control {
                    speed_control.set(1.5);
                }
            }
            let sample =
                (std::f32::consts::TAU * FREQUENCY * self.cursor as f32 / SAMPLE_RATE as f32).sin();
            self.cursor += 1;
            Some(sample)
        }
    }

    impl Source for SineSource {
        fn current_frame_len(&self) -> Option<usize> {
            Some(self.frames.saturating_sub(self.cursor))
        }

        fn channels(&self) -> u16 {
            1
        }

        fn sample_rate(&self) -> u32 {
            SAMPLE_RATE
        }

        fn total_duration(&self) -> Option<Duration> {
            Some(Duration::from_secs_f64(
                self.frames as f64 / SAMPLE_RATE as f64,
            ))
        }

        fn try_seek(&mut self, position: Duration) -> Result<(), SeekError> {
            let requested_frame =
                (position.as_secs_f64() * f64::from(SAMPLE_RATE)).round() as usize;
            self.cursor = requested_frame.min(self.frames);
            Ok(())
        }
    }

    fn source(frames: usize) -> SineSource {
        SineSource {
            cursor: 0,
            frames,
            speed_control: None,
            change_speed_at_frame: None,
        }
    }

    fn dominant_frequency(samples: &[f32]) -> f32 {
        let start = samples.len() / 10;
        let end = samples.len() * 9 / 10;
        let middle = &samples[start..end];
        let crossings = middle
            .windows(2)
            .filter(|pair| (pair[0] <= 0.0 && pair[1] > 0.0) || (pair[0] >= 0.0 && pair[1] < 0.0))
            .count();
        crossings as f32 * SAMPLE_RATE as f32 / (2.0 * middle.len() as f32)
    }

    fn wrap(source: SineSource, speed: f32) -> (PitchPreservingSource<SineSource>, Arc<AtomicU64>) {
        let emitted = Arc::new(AtomicU64::new(0));
        let wrapped = PitchPreservingSource::new(
            source,
            SpeedControl::new(speed),
            BoosterGain::new(1.0),
            Arc::clone(&emitted),
        )
        .expect("valid mono source");
        (wrapped, emitted)
    }

    struct MixerYieldSource {
        yields_left: usize,
        real_samples_before_yield: usize,
        yield_to_mixer: Arc<AtomicBool>,
        yield_count: Arc<AtomicUsize>,
        call_count: Arc<AtomicUsize>,
    }

    impl Iterator for MixerYieldSource {
        type Item = f32;

        fn next(&mut self) -> Option<Self::Item> {
            self.call_count.fetch_add(1, Ordering::SeqCst);
            if self.real_samples_before_yield > 0 {
                self.real_samples_before_yield -= 1;
                return Some(0.25);
            }
            if self.yields_left > 0 {
                self.yields_left -= 1;
                self.yield_count.fetch_add(1, Ordering::SeqCst);
                self.yield_to_mixer.store(true, Ordering::Release);
                return Some(0.0);
            }
            Some(0.25)
        }
    }

    impl Source for MixerYieldSource {
        fn current_frame_len(&self) -> Option<usize> {
            None
        }

        fn channels(&self) -> u16 {
            2
        }

        fn sample_rate(&self) -> u32 {
            SAMPLE_RATE
        }

        fn total_duration(&self) -> Option<Duration> {
            None
        }

        fn try_seek(&mut self, _position: Duration) -> Result<(), SeekError> {
            Ok(())
        }
    }

    fn yielding_source(
        yields_left: usize,
        real_samples_before_yield: usize,
    ) -> (
        MixerYieldSource,
        Arc<AtomicBool>,
        Arc<AtomicUsize>,
        Arc<AtomicUsize>,
    ) {
        let yield_to_mixer = Arc::new(AtomicBool::new(false));
        let yield_count = Arc::new(AtomicUsize::new(0));
        let call_count = Arc::new(AtomicUsize::new(0));
        (
            MixerYieldSource {
                yields_left,
                real_samples_before_yield,
                yield_to_mixer: Arc::clone(&yield_to_mixer),
                yield_count: Arc::clone(&yield_count),
                call_count: Arc::clone(&call_count),
            },
            yield_to_mixer,
            yield_count,
            call_count,
        )
    }

    #[test]
    fn buffer_underrun_preserves_channel_alignment_and_does_not_count_progress() {
        let (inner, yield_to_mixer, yield_count, call_count) = yielding_source(1, 2);
        let emitted = Arc::new(AtomicU64::new(0));
        let mut wrapped = PitchPreservingSource::new(
            inner,
            SpeedControl::new(1.0),
            BoosterGain::new(1.0),
            Arc::clone(&emitted),
        )
        .expect("valid stereo source");
        wrapped.set_underrun_signal(yield_to_mixer);

        assert_eq!(wrapped.next(), Some(0.0));
        assert_eq!(wrapped.next(), Some(0.0));
        assert_eq!(yield_count.load(Ordering::SeqCst), 1);
        assert_eq!(call_count.load(Ordering::SeqCst), 3);
        assert_eq!(emitted.load(Ordering::Relaxed), 0);

        // An underrun yields one aligned frame; the next pull consumes any newly available input
        // without a wall-clock cooldown.
        assert!(wrapped.next().is_some());
        assert!(call_count.load(Ordering::SeqCst) > 3);
    }

    #[test]
    fn gapless_handoff_waits_until_stretched_content_is_returned() {
        let (inner, yield_to_mixer, _, _) = yielding_source(1, 2);
        let emitted = Arc::new(AtomicU64::new(0));
        let mut wrapped = PitchPreservingSource::new(
            inner,
            SpeedControl::new(1.0),
            BoosterGain::new(1.0),
            emitted,
        )
        .expect("valid stereo source");
        wrapped.set_underrun_signal(yield_to_mixer);
        let content_started = wrapped.real_content_started();
        let callback_count = Arc::new(AtomicUsize::new(0));
        let callback_for_handoff = Arc::clone(&callback_count);
        let mut handoff =
            GaplessHandoffSource::new_after_real_content(wrapped, content_started, move || {
                callback_for_handoff.fetch_add(1, Ordering::Relaxed);
            });

        // The source prefetched two real samples, then encountered a decoder yield. The
        // callback must wait until a stretched sample is actually returned.
        assert_eq!(handoff.next(), Some(0.0));
        assert_eq!(callback_count.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn seeking_forwards_to_the_inner_source_and_resets_progress() {
        let (mut wrapped, emitted) = wrap(source(SAMPLE_RATE as usize * 4), 1.0);
        let _: Vec<_> = wrapped.by_ref().take(512).collect();
        assert_eq!(emitted.load(Ordering::Relaxed), 512);

        let target = Duration::from_secs(2);
        wrapped
            .try_seek(target)
            .expect("the stretcher should forward seeking to its source");

        assert_eq!(wrapped.inner.cursor, SAMPLE_RATE as usize * 2);
        assert_eq!(emitted.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn faster_playback_shortens_audio_without_shifting_tone_frequency() {
        let (wrapped, emitted) = wrap(source(SAMPLE_RATE as usize * 4), SPEED);
        let output: Vec<f32> = wrapped.collect();

        let expected_samples = SAMPLE_RATE as f32 * 4.0 / SPEED;
        let duration_ratio = output.len() as f32 / expected_samples;
        assert!(
            (0.92..=1.08).contains(&duration_ratio),
            "output duration did not follow {SPEED}x speed: got {} samples, expected about {expected_samples} (ratio {duration_ratio:.3})",
            output.len()
        );
        let source_duration_ratio =
            emitted.load(Ordering::Relaxed) as f32 / (SAMPLE_RATE as f32 * 4.0);
        assert!(
            (0.92..=1.08).contains(&source_duration_ratio),
            "source progress should follow decoded media time: ratio {source_duration_ratio:.3}"
        );

        let actual_frequency = dominant_frequency(&output);
        assert!(
            (actual_frequency - FREQUENCY).abs() / FREQUENCY < 0.05,
            "pitch shifted to {actual_frequency:.1} Hz at {SPEED}x (expected {FREQUENCY} Hz)"
        );
    }

    #[test]
    fn live_speed_change_updates_the_output_duration() {
        let speed_control = SpeedControl::new(1.0);
        let source = SineSource {
            cursor: 0,
            frames: SAMPLE_RATE as usize * 4,
            speed_control: Some(speed_control.clone()),
            change_speed_at_frame: Some(SAMPLE_RATE as usize),
        };
        let emitted = Arc::new(AtomicU64::new(0));
        let wrapped = PitchPreservingSource::new(
            source,
            speed_control,
            BoosterGain::new(1.0),
            Arc::clone(&emitted),
        )
        .expect("valid mono source");
        let output: Vec<f32> = wrapped.collect();

        let expected_samples = SAMPLE_RATE as f32 * 3.0;
        let duration_ratio = output.len() as f32 / expected_samples;
        assert!(
            (0.88..=1.12).contains(&duration_ratio),
            "dynamic 1.0x then 1.5x speed should produce about {expected_samples} samples, got {} (ratio {duration_ratio:.3})",
            output.len()
        );
        let source_duration_ratio =
            emitted.load(Ordering::Relaxed) as f32 / (SAMPLE_RATE as f32 * 4.0);
        assert!(
            (0.92..=1.08).contains(&source_duration_ratio),
            "source progress should follow decoded media time after a speed change: ratio {source_duration_ratio:.3}"
        );
    }

    #[test]
    fn unchanged_speed_preserves_duration_and_tone_frequency() {
        let (wrapped, emitted) = wrap(source(SAMPLE_RATE as usize * 3), 1.0);
        let output: Vec<f32> = wrapped.collect();

        let duration_ratio = output.len() as f32 / (SAMPLE_RATE as f32 * 3.0);
        assert!(
            (0.92..=1.08).contains(&duration_ratio),
            "1.0x playback changed duration: got {} samples (ratio {duration_ratio:.3})",
            output.len()
        );
        assert_eq!(emitted.load(Ordering::Relaxed) as usize, output.len());
        let actual_frequency = dominant_frequency(&output);
        assert!(
            (actual_frequency - FREQUENCY).abs() / FREQUENCY < 0.05,
            "1.0x playback shifted tone to {actual_frequency:.1} Hz"
        );
    }
}
