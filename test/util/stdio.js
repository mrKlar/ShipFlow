// Captures stdout/stderr writes plus console.log/console.error calls during
// the supplied function. Returns the function's result alongside the captured
// strings. Works with sync or async fns: when fn returns a Promise, the
// resolved value is returned and stdio capture extends across the await.

export function captureStdio(fn) {
  const out = [];
  const err = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  const origLog = console.log;
  const origErrLog = console.error;
  process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  console.log = (...args) => { out.push(args.join(" ") + "\n"); };
  console.error = (...args) => { err.push(args.join(" ") + "\n"); };

  function restore() {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
    console.log = origLog;
    console.error = origErrLog;
  }

  let result;
  try {
    result = fn();
  } catch (caught) {
    restore();
    throw caught;
  }

  if (result && typeof result.then === "function") {
    return result.then(
      value => { restore(); return { result: value, stdout: out.join(""), stderr: err.join("") }; },
      caught => { restore(); throw caught; },
    );
  }

  restore();
  return { result, stdout: out.join(""), stderr: err.join("") };
}
