import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MacroCalendarSubSection } from '@/components/MacroCalendarSubSection';
import { fetchMacroCalendar } from '@/lib/analyze';
vi.mock('@/lib/analyze', () => ({ fetchMacroCalendar: vi.fn() }));

it('defaults to a bounded high-impact calendar, then lets the user broaden it without a new request', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const events = Array.from({ length: 40 }, (_, i) => ({ event: `Important event ${i}`, date: `${today} 14:00`, country: 'US', impact: 'High' as const, actual: null, estimate: null, previous: null, unit: null }));
  vi.mocked(fetchMacroCalendar).mockResolvedValue({ events: [...events, events[0], { ...events[0], event: 'Medium event', impact: 'Medium' }], source: 'fmp', from: today, to: today, fetchedAt: today });
  render(<MacroCalendarSubSection />);
  await waitFor(() => expect(screen.getAllByText(/^Important event/)).toHaveLength(10));
  expect(screen.queryByText('Medium event')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Ampliar/ }));
  expect(screen.getAllByText(/^Important event/)).toHaveLength(30);
  expect(fetchMacroCalendar).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: /selección esencial/ }));
  expect(screen.getAllByText(/^Important event/)).toHaveLength(10);
});
