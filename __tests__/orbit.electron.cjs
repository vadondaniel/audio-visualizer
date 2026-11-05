// Run with: npm run test:electron -- orbit
require("./helpers/visual-check.cjs")(
  process.argv.includes("--prism") ? "prism" : "orbit"
);
