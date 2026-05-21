// Phase-E baseline tests — the Button primitive, exercising both the
// vanilla path and the loading-spinner branch. Component-level smoke
// test: confirms the React tree mounts, prop spreading works, and
// className composition via cva is intact.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('fires onClick when not disabled', async () => {
    const user = userEvent.setup();
    let clicks = 0;
    render(<Button onClick={() => clicks++}>Hit</Button>);
    await user.click(screen.getByRole('button', { name: 'Hit' }));
    expect(clicks).toBe(1);
  });

  it('does NOT fire onClick when disabled', async () => {
    const user = userEvent.setup();
    let clicks = 0;
    render(
      <Button disabled onClick={() => clicks++}>
        Hit
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Hit' }));
    expect(clicks).toBe(0);
  });

  it('loading=true disables the button AND shows the spinner', () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn).toBeDisabled();
    // Spinner is decorative (aria-hidden) — but its <svg> sibling must
    // exist. Lucide renders a <svg> with class containing "lucide".
    expect(btn.querySelector('svg')).not.toBeNull();
  });

  it('respects the variant prop via class composition', () => {
    const { rerender } = render(<Button variant="primary">P</Button>);
    expect(screen.getByRole('button').className).toContain('bg-brand-600');
    rerender(<Button variant="danger">D</Button>);
    expect(screen.getByRole('button').className).toContain('bg-danger');
  });
});
