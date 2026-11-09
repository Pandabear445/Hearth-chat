// fn over a list, at most `limit` at a time, results in the list's order: what a loop awaiting each one in turn gives,
// only sooner. The browser does much of the work for each (key derivation, signing) off the page, so several at once
// finish well before the same ones one after another.
// On a failure no more are started, those already running finish, and the error thrown is that of the earliest item
// in the list that failed: the same one the loop would have stopped at, as every item before it was started too.
export async function mapLimit(items, limit, fn) {
  const list = Array.from(items);
  const out = new Array(list.length);
  const failed = []; // [index, error]
  let next = 0;
  const worker = async () => {
    while (!failed.length && next < list.length) {
      const i = next++;
      try { out[i] = await fn(list[i], i); } catch (e) { failed.push([i, e]); }
    }
  };
  const n = Math.max(1, Math.min(Math.floor(limit) || 1, list.length));
  await Promise.all(Array.from({ length: n }, worker));
  if (failed.length) throw failed.reduce((a, b) => (b[0] < a[0] ? b : a))[1];
  return out;
}
