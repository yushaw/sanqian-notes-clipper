// Epoch seconds -> YYYY-MM-DD in the clipper's local timezone.
//
// Platforms (bilibili, wechat) publish epoch timestamps and display the date
// in the content's local timezone; a UTC conversion (toISOString) records the
// previous day for anything published in the first hours of a CST day. The
// user's machine timezone is the best available proxy for the content's
// timezone (people overwhelmingly clip content from their own region).

export function epochToLocalDate(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}
