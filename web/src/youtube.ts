export function youtubeId(input: string): string | null {
  const value = input.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
    if (url.username || url.password || url.port) return null;
    let id: string | null = null;
    if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else id = url.pathname.match(/^\/shorts\/([^/]+)\/?$/)?.[1] ?? null;
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
