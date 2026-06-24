// Today's date in IST, regardless of where the server runs.
export function istParts(d: Date = new Date()): { date: string; month: string } {
  // en-CA formats as YYYY-MM-DD
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return { date, month: date.slice(0, 7) }; // month tab title: "YYYY-MM"
}
