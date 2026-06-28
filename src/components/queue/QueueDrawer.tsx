import { memo } from 'react';
import { Drawer } from 'vaul';
import { glssDeep } from '../ui/liquid-glass';
import { QueueView } from './QueueView';

interface QueueDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const QueueDrawer = memo(({ open, onOpenChange }: QueueDrawerProps) => {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 mt-24 flex h-[85vh] flex-col rounded-t-[32px] outline-none"
          style={{
            ...glssDeep(32),
            background: 'linear-gradient(180deg, rgba(20,15,12,0.92) 0%, rgba(11,10,10,0.98) 100%)',
            boxShadow: '0 -12px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)',
          }}
        >
          <div className="mx-auto mt-4 h-1.5 w-12 shrink-0 rounded-full bg-white/20" />

          <div className="flex-1 overflow-hidden p-2">
            <QueueView />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
});

QueueDrawer.displayName = 'QueueDrawer';
