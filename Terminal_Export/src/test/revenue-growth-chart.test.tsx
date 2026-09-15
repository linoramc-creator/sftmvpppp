import { render, screen } from '@testing-library/react';
import { RevenueGrowthBars } from '@/components/charts/RevenueGrowthChart';
it('draws finite positive, negative and zero bars while preserving missing quarters', () => {
  const { container } = render(<RevenueGrowthBars data={[{ period: '2024-03-31', revenueGrowth: null }, { period: '2024-06-30', revenueGrowth: 25 }, { period: '2024-09-30', revenueGrowth: null }, { period: '2024-12-31', revenueGrowth: -10 }, { period: '2025-03-31', revenueGrowth: 0 }]} />);
  expect(screen.getByRole('img', { name: /barras/ })).toBeInTheDocument();
  const bars = screen.getAllByTestId('revenue-growth-bar');
  expect(bars).toHaveLength(3);
  for (const bar of bars) for (const attr of ['x', 'y', 'width', 'height']) expect(Number.isFinite(Number(bar.getAttribute(attr)))).toBe(true);
  expect(bars[1]).toHaveAttribute('fill', '#f87171');
  expect(container.textContent).toContain('N/D');
});
it('does not display an empty or invalid chart when no comparable periods exist', () => {
  render(<RevenueGrowthBars data={[{ period: '2025-03-31', revenueGrowth: null }]} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText(/No hay períodos comparables/)).toBeInTheDocument();
});
