// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TextField } from './ui';

afterEach(cleanup);

describe('TextField', () => {
  // iOS Safari can refuse focus/typing inside a `user-select: none` ancestor (the kiosk root sets select-none).
  it('opts back into text selection so it stays typeable on iPad Safari', () => {
    render(<TextField label="Name" value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Name').className).toContain('select-text');
  });
});
