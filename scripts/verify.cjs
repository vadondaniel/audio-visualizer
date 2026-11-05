const path = require("node:path");
const { projectRoot } = require("./verification-paths.cjs");
const {
  discoverChecks,
  selectChecks,
  runChecks,
} = require("./verification-runner.cjs");

function buildChecks(argv) {
  const [command, ...args] = argv;
  let checks;
  if (command === "electron") checks = selectChecks(discoverChecks(), args);
  else if (command === "benchmark" || command === "benchmark-smoke") {
    const smoke = command === "benchmark-smoke";
    if (smoke && args.length)
      throw Error(
        "benchmark:smoke uses a fixed bounded preset; use npm run benchmark for custom options"
      );
    checks = [
      {
        name: command,
        entry: path.join(projectRoot, "benchmarks/benchmark.js"),
        timeoutMs: smoke ? 60000 : null,
        args: smoke
          ? [
              "modes=particles,tunnel,orbit,prism",
              "scenarios=mixed",
              "repeats=1",
              "warmup=250",
              "duration=1000",
              "trace=false",
              "ops=false",
              "keep-window=false",
            ]
          : args,
      },
    ];
  } else throw Error("Expected electron, benchmark, or benchmark-smoke");
  return checks;
}
async function main(argv = process.argv.slice(2)) {
  const checks = buildChecks(argv);
  // Resolve before creating profiles or launching anything.
  const executable = require("electron");
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    return (await runChecks(checks, { executable, signal: controller.signal }))
      .exitCode;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}
if (require.main === module)
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
module.exports = { main, buildChecks };
