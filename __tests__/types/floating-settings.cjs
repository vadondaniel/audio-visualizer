const Protocol = require("../../src/settings-protocol");
const Client = require("../../src/settings-client");
const Controller = require("../../src/settings-window");
/** @param {import('../../src/settings-protocol').ClientApi} client
 * @param {import('../../src/settings-protocol').OwnerApi} owner
 * @param {import('../../src/settings-client').Dependencies} view
 * @param {import('../../src/settings-window').Dependencies} native */
function contracts(client, owner, view, native) {
  client.dispatch({ type: "set", key: "sensitivity", value: 1.8 });
  client.dispatch({ type: "mode", id: "orbit" });
  client.dispatch({
    type: "background",
    name: "image.png",
    dataUrl: "data:image/png;base64,AA==",
  });
  client.onPatch((patch) => patch.effectiveMode);
  owner.onRequest((request) => request.operation);
  const controller = Controller.create(native);
  controller.open();
  controller.close();
  controller.dispose();
  const ui = Client.create(view);
  ui.start();
  ui.dispose();
  // @ts-expect-error Runtime animation state cannot be changed by settings commands.
  client.dispatch({ type: "set", key: "hueShift", value: 10 });
  // @ts-expect-error Values are correlated with setting keys.
  client.dispatch({ type: "set", key: "sensitivity", value: true });
  // @ts-expect-error Background assignment is one complete operation.
  client.dispatch({
    type: "background",
    dataUrl: "data:image/png;base64,AA==",
  });
  // @ts-expect-error The restricted API has no arbitrary owner invocation.
  client.invoke("startCapture");
  owner.publish({
    revision: 1,
    effectiveMode: "orbit",
    packaged: false,
    // @ts-expect-error Audio buffers never enter revisioned UI updates.
    values: { freqData: new Uint8Array(4) },
  });
  // @ts-expect-error Diagnostics use the explicit operations only.
  client.diagnostics("execute");
  // @ts-expect-error Native-window authority is required at composition.
  Controller.create({ ...native, present: null });
  // @ts-expect-error Floating view requires the restricted command API.
  Client.create({ ...view, api: owner });
  return Protocol.isPatch({});
}
module.exports = { contracts };
