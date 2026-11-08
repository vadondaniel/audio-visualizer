// Signed, coupled springs. Only update advances the simulation; draw reads its pose.
/** @typedef {{circular:boolean,displacement:Float64Array,velocity:Float64Array,acceleration:Float64Array,target:Float64Array,previous:Float64Array,accumulator:number}} RopeState */
/** @typedef {import('../visual-contracts').VisualTuning['rope']} RopeTuning */
/** @template T @param {typeof globalThis} root @param {()=>T} build */
(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ModeRegistry.registerFactory("rope", api.createMode);
})(globalThis, function () {
  const BANDS = 96;
  /** Alternate complete frequency sweeps around mirrored halves/quarters.
   * @param {import('../visual-contracts').Samples} bands @param {number} sections @param {Float64Array} output @param {boolean} [closed] */
  function mirrorBands(bands, sections, output, closed = true) {
    for (let i = 0; i < BANDS; i++) {
      const phase = (i * sections) / (closed ? BANDS : BANDS - 1);
      const section = Math.floor(phase),
        fraction = phase - section;
      const source = (section % 2 ? 1 - fraction : fraction) * (BANDS - 1);
      const low = Math.floor(source),
        high = Math.min(BANDS - 1, low + 1);
      output[i] = bands[low] + (bands[high] - bands[low]) * (source - low);
    }
  }
  /** @param {boolean} circular @returns {RopeState} */
  function createRopeState(circular) {
    const length = circular ? BANDS : BANDS + 2;
    return {
      circular,
      displacement: new Float64Array(length),
      velocity: new Float64Array(length),
      acceleration: new Float64Array(length),
      target: new Float64Array(BANDS),
      previous: new Float64Array(BANDS),
      accumulator: 0,
    };
  }
  /** @param {RopeState} state */
  function resetRope(state) {
    state.displacement.fill(0);
    state.velocity.fill(0);
    state.acceleration.fill(0);
    state.target.fill(0);
    state.previous.fill(0);
    state.accumulator = 0;
  }
  /** Finished bands provide the external force, never another audio-processing stage.
   * @param {RopeState} state @param {import('../visual-contracts').Samples} bands @param {number} dtSec @param {RopeTuning} tuning */
  function advanceRope(state, bands, dtSec, tuning) {
    if (!Number.isFinite(dtSec) || dtSec <= 0) return;
    const { displacement, velocity, acceleration, target, previous, circular } =
      state;
    const offset = circular ? 0 : 1,
      last = displacement.length - 1;
    for (let i = 0; i < BANDS; i++) {
      const level = Number.isFinite(bands[i])
        ? Math.min(1, Math.max(0, bands[i]))
        : 0;
      velocity[i + offset] +=
        tuning.onsetKick * Math.max(0, level - previous[i]);
      previous[i] = level;
      target[i] = tuning.targetScale * level;
    }
    const step = tuning.stepSec,
      coupling = circular ? tuning.circularCoupling : tuning.coupling,
      restoring = circular ? tuning.circularRestoring : tuning.restoring,
      damping = Math.exp(
        -(circular ? tuning.circularDamping : tuning.damping) * step
      );
    state.accumulator += Math.min(tuning.maxFrameSec, dtSec);
    while (state.accumulator + 1e-12 >= step) {
      for (let i = offset; i < offset + BANDS; i++) {
        const left = displacement[i === 0 ? last : i - 1],
          right = displacement[i === last ? 0 : i + 1];
        acceleration[i] =
          restoring * (target[i - offset] - displacement[i]) +
          coupling * (left + right - 2 * displacement[i]);
      }
      for (let i = offset; i < offset + BANDS; i++) {
        velocity[i] = (velocity[i] + acceleration[i] * step) * damping;
        displacement[i] += velocity[i] * step;
        if (displacement[i] > tuning.limit) {
          displacement[i] = tuning.limit;
          velocity[i] = Math.min(0, velocity[i]);
        } else if (displacement[i] < -tuning.limit) {
          displacement[i] = -tuning.limit;
          velocity[i] = Math.max(0, velocity[i]);
        }
      }
      state.accumulator -= step;
    }
    state.accumulator = Math.max(0, state.accumulator);
    if (!circular) {
      displacement[0] = displacement[last] = velocity[0] = velocity[last] = 0;
    }
  }
  /** @param {import('../visual-contracts').Services} services @returns {import('../visual-contracts').Mode} */
  function createMode(services) {
    const tuning = services.constants.VISUAL_TUNING.rope;
    const circular = createRopeState(true),
      circular2 = createRopeState(true),
      circular4 = createRopeState(true),
      straight = createRopeState(false),
      straight2 = createRopeState(false);
    const mirroredBands = new Float64Array(BANDS);
    /** @param {import('../visual-contracts').Frame} frame */
    function selectedState(frame) {
      switch (frame.settings.ropeLayout) {
        case "straight":
          return straight;
        case "straight-2":
          return straight2;
        case "circular-2":
          return circular2;
        case "circular-4":
          return circular4;
        default:
          return circular;
      }
    }
    const points = new Float64Array((BANDS + 2) * 2);
    const renderBounds = { x: 0, y: 0, width: 0, height: 0 },
      overlayBounds = { x: 0, y: 0, width: 0, height: 0 };
    /** @param {import('../visual-contracts').Frame} frame */
    function update(frame) {
      const layout = frame.settings.ropeLayout;
      const mirrored =
        layout === "circular-2" ||
        layout === "circular-4" ||
        layout === "straight-2";
      if (mirrored)
        mirrorBands(
          frame.signals.bands,
          layout === "circular-4" ? 4 : 2,
          mirroredBands,
          layout !== "straight-2"
        );
      advanceRope(
        selectedState(frame),
        mirrored ? mirroredBands : frame.signals.bands,
        frame.dtSec,
        tuning
      );
    }
    /** @param {import('../visual-contracts').Frame} frame @param {boolean} loop */
    function preparePoints(frame, loop) {
      const values = selectedState(frame).displacement,
        size = Math.min(frame.width, frame.height);
      for (let i = 0; i < values.length; i++) {
        if (loop) {
          const angle = -Math.PI / 2 + (i * Math.PI * 2) / BANDS,
            radius =
              size * (tuning.radiusFrac - tuning.radialScale * values[i]);
          points[i * 2] = frame.width / 2 + Math.cos(angle) * radius;
          points[i * 2 + 1] = frame.height / 2 + Math.sin(angle) * radius;
        } else {
          points[i * 2] = (i * frame.width) / (values.length - 1);
          points[i * 2 + 1] =
            frame.height * (0.5 - tuning.straightScale * values[i]);
        }
      }
      return values.length;
    }
    /** Quadratic controls stay within the node hull, including the closing seam.
     * @param {CanvasRenderingContext2D} ctx @param {number} count @param {boolean} loop */
    function path(ctx, count, loop) {
      ctx.beginPath();
      if (loop) {
        ctx.moveTo(
          (points[(count - 1) * 2] + points[0]) / 2,
          (points[(count - 1) * 2 + 1] + points[1]) / 2
        );
        for (let i = 0; i < count; i++) {
          const next = (i + 1) % count;
          ctx.quadraticCurveTo(
            points[i * 2],
            points[i * 2 + 1],
            (points[i * 2] + points[next * 2]) / 2,
            (points[i * 2 + 1] + points[next * 2 + 1]) / 2
          );
        }
        ctx.closePath();
      } else {
        ctx.moveTo(points[0], points[1]);
        for (let i = 1; i < count - 1; i++)
          ctx.quadraticCurveTo(
            points[i * 2],
            points[i * 2 + 1],
            (points[i * 2] + points[(i + 1) * 2]) / 2,
            (points[i * 2 + 1] + points[(i + 1) * 2 + 1]) / 2
          );
        ctx.quadraticCurveTo(
          points[(count - 1) * 2],
          points[(count - 1) * 2 + 1],
          points[(count - 1) * 2],
          points[(count - 1) * 2 + 1]
        );
      }
    }
    /** @param {CanvasRenderingContext2D} ctx @param {import('../visual-contracts').Frame} frame */
    function draw(ctx, frame) {
      const loop = selectedState(frame).circular,
        count = preparePoints(frame, loop),
        size = Math.min(frame.width, frame.height);
      const theme = services.constants.THEMES[frame.settings.theme],
        rainbow = !!theme?.rainbow;
      const gradient = loop
        ? ctx.createConicGradient(
            -Math.PI / 2,
            frame.width / 2,
            frame.height / 2
          )
        : ctx.createLinearGradient(0, 0, frame.width, 0);
      const rotation = services.palette.currentHue(0);
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const hue =
          loop && rainbow
            ? (rotation + 360 * t) % 360
            : services.palette.currentHue(
                loop ? (1 - Math.cos(t * Math.PI * 2)) / 2 : t
              );
        gradient.addColorStop(
          t,
          services.palette.themeCssColor(hue, 90, 70, 1)
        );
      }
      ctx.strokeStyle = gradient;
      ctx.lineWidth = Math.max(
        tuning.minLineWidth,
        size * tuning.lineWidthScale
      );
      ctx.lineJoin = ctx.lineCap = "round";
      path(ctx, count, loop);
      if (rainbow) {
        ctx.shadowBlur = 0;
        if (frame.settings.glowIntensity > 0) {
          ctx.save();
          ctx.filter = `blur(${6 * frame.settings.glowIntensity}px)`;
          ctx.globalAlpha = Math.min(1, 0.65 * frame.settings.glowIntensity);
          ctx.lineWidth += 5 * frame.settings.glowIntensity;
          ctx.stroke();
          ctx.restore();
        }
      } else
        services.applyGlow(
          ctx,
          services.palette.themeCssColor(
            services.palette.currentHue(0.5),
            90,
            65,
            1
          ),
          tuning.glowBlur,
          frame.settings.glowIntensity
        );
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    /** @param {import('../visual-contracts').Frame} frame @param {boolean} glow */
    function bounds(frame, glow) {
      if (!selectedState(frame).circular) return null;
      const result = glow ? renderBounds : overlayBounds,
        size = Math.min(frame.width, frame.height);
      const extent =
        size * (tuning.radiusFrac + tuning.radialScale * tuning.limit) +
        Math.max(tuning.minLineWidth, size * tuning.lineWidthScale) / 2 +
        2 +
        (glow ? 4 * tuning.glowBlur * frame.settings.glowIntensity : 0);
      result.x = frame.width / 2 - extent;
      result.y = frame.height / 2 - extent;
      result.width = result.height = extent * 2;
      return result;
    }
    return {
      update,
      draw,
      reset() {
        resetRope(circular);
        resetRope(circular2);
        resetRope(circular4);
        resetRope(straight);
        resetRope(straight2);
        mirroredBands.fill(0);
        points.fill(0);
      },
      getOverlayBounds: (frame) => bounds(frame, false),
      getRenderBounds: (frame) => bounds(frame, true),
    };
  }
  return { createMode, createRopeState, advanceRope, resetRope, mirrorBands };
});
