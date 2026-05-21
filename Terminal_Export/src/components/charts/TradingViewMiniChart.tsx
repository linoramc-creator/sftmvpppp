import React, { useEffect, useRef } from 'react';

interface Props {
  symbol: string;       // e.g. "TVC:SPX"
  label: string;        // displayed above the chart
  height?: number;
}

// TradingView's official mini-chart embed widget. Loads a script from
// s3.tradingview.com that injects an iframe with a real-time chart.
// No API key needed; free for embedding.
export function TradingViewMiniChart({ symbol, label, height = 110 }: Props) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    container.current.innerHTML = '';

    const widgetDiv = document.createElement('div');
    widgetDiv.className = 'tradingview-widget-container__widget';
    container.current.appendChild(widgetDiv);

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js';
    script.async = true;
    script.type = 'text/javascript';
    script.innerHTML = JSON.stringify({
      symbol,
      width: '100%',
      height,
      locale: 'es',
      dateRange: '1M',
      colorTheme: 'dark',
      trendLineColor: 'rgba(59, 130, 246, 1)',
      underLineColor: 'rgba(59, 130, 246, 0.15)',
      underLineBottomColor: 'rgba(59, 130, 246, 0)',
      isTransparent: true,
      autosize: false,
      largeChartUrl: '',
      chartOnly: false,
      noTimeScale: false,
    });
    container.current.appendChild(script);

    return () => {
      if (container.current) container.current.innerHTML = '';
    };
  }, [symbol, height]);

  return (
    <div style={{
      background: '#0d1520',
      border: '1px solid #1e293b',
      borderRadius: 4,
      padding: '6px 8px 4px',
      marginBottom: 6,
    }}>
      <div style={{
        fontSize: 9,
        letterSpacing: '0.12em',
        color: '#94a3b8',
        textTransform: 'uppercase',
        marginBottom: 2,
        fontWeight: 600,
      }}>
        {label}
      </div>
      <div ref={container} className="tradingview-widget-container" style={{ width: '100%' }} />
    </div>
  );
}
