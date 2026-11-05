const fs = require("node:fs");
const path = require("node:path");
const projectRoot = path.resolve(__dirname, "..");
const verificationRoot = path.join(projectRoot, "dist", "verification");

function contained(root, target) {
  const absolute = path.resolve(target);
  const relative = path.relative(path.resolve(root), absolute);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw Error(`Refusing path outside owned directory: ${absolute}`);
  return absolute;
}
function createRunDirectory(prefix) {
  fs.mkdirSync(verificationRoot, { recursive: true });
  return fs.mkdtempSync(path.join(verificationRoot, `${prefix}-`));
}
function configureProfile(app) {
  const directory =
    process.env.AV_VERIFICATION_DIRECTORY || createRunDirectory("manual");
  const profile = contained(
    directory,
    process.env.AV_VERIFICATION_PROFILE || path.join(directory, "profile")
  );
  const artifacts = contained(directory, path.join(directory, "artifacts"));
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(artifacts, { recursive: true });
  process.env.AV_VERIFICATION_DIRECTORY = directory;
  process.env.AV_VERIFICATION_PROFILE = profile;
  app.setPath("userData", profile);
  app.setPath("sessionData", profile);
  return { directory, profile, artifacts };
}
function removeProfile(directory, profile) {
  const owned = contained(directory, profile);
  if (!fs.existsSync(owned)) return;
  contained(fs.realpathSync(directory), fs.realpathSync(owned));
  fs.rmSync(owned, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
module.exports = {
  projectRoot,
  verificationRoot,
  contained,
  createRunDirectory,
  configureProfile,
  removeProfile,
};
