import React, { useEffect, useRef } from 'react';

interface IndexChartProps {
  symbol?: 'SP:SPX' | 'NASDAQ:COMP' | 'DJ:DJI';
  height?: number;
}

export const IndexChartOnly = ({ symbol = 'SP:SPX', height = 350 }: IndexChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      "autosize": true,
      "symbol": symbol,
      "interval": "D",
      "timezone": "Etc/UTC",
      "theme": "dark",
      "style": "3",
      "locale": "es",
      "hide_top_toolbar": true,
      "hide_side_toolbar": true,
      "allow_symbol_change": false,
      "save_image": false,
      "calendar": false,
      "hide_volume": true,
      "support_host": "https://www.tradingview.com"
    });

    containerRef.current.appendChild(script);
  }, [symbol]);

  return (
    <div
      ref={containerRef}
      style={{ height: `${height}px`, width: "100%", borderRadius: "8px", overflow: "hidden" }}
    />
  );
};

interface MiniChartProps {
  symbol: 'SP:SPX' | 'NASDAQ:COMP' | 'DJ:DJI';
}

export const IndexMiniChart = ({ symbol }: MiniChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-mini-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      "symbol": symbol,
      "width": "100%",
      "height": "100%",
      "locale": "es",
      "dateRange": "12M",
      "colorTheme": "dark",
      "isTransparent": true,
      "autosize": true
    });

    containerRef.current.appendChild(script);
  }, [symbol]);

  return (
    <div
      ref={containerRef}
      style={{ height: "120px", width: "100%", minWidth: "200px" }}
    />
  );
};
