import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatePanel } from './StatePanel';

const meta = {
  title: 'UI/StatePanel',
  component: StatePanel,
  parameters: { layout: 'centered' },
  args: {
    title: 'The library needs attention',
    description: 'The last request did not finish. You can try it again without losing your work.',
    className: 'w-[min(100%,38rem)]',
  },
} satisfies Meta<typeof StatePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ToneMatrix: Story = {
  render: (args) => (
    <div className="grid w-[min(100vw-2rem,52rem)] gap-3">
      <StatePanel {...args} tone="info" title="Search is ready" />
      <StatePanel {...args} tone="success" title="Library scan complete" />
      <StatePanel {...args} tone="warning" title="Some results are unavailable" />
      <StatePanel {...args} tone="error" title="Could not load the queue" />
      <StatePanel {...args} tone="loading" title="Loading library data" action={undefined} />
    </div>
  ),
};

export const Retry: Story = {
  args: {
    tone: 'error',
    title: 'Could not load the queue',
    description: 'The database did not respond. Your existing queue is unchanged.',
    action: { label: 'Retry', onClick: () => undefined },
  },
};

export const Neobrutalism: Story = {
  globals: { theme: 'neobrutalism' },
  args: {
    tone: 'warning',
    title: 'Bulk editing is still loading',
    description: '5,120 of 8,240 tracks are ready.',
    action: { label: 'Retry', onClick: () => undefined },
  },
};
