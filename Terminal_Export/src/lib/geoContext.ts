const KEY = import.meta.env.VITE_TAVILY_KEY as string;

export async function fetchGeoContext(ticker: string, companyName: string) {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: KEY,
        query: `${companyName} ${ticker} geopolitical risk supply chain regulatory 2025`,
        search_depth: "basic",
        max_results: 3,
        include_answer: true,
      }),
    });
    if (!res.ok) return { answer: "", sources: [] };
    const data = await res.json();
    return {
      answer: data.answer ?? "",
      sources: (data.results ?? []).map((r: any) => ({ title: r.title, url: r.url })),
    };
  } catch {
    return { answer: "", sources: [] };
  }
}
