# Thin Film Simulator

An interactive WebGL 2 simulation of fluid motion and thin-film interference on a soap bubble.

**Live site:** [bubble-film-lab.exobyt.chatgpt.site](https://bubble-film-lab.exobyt.chatgpt.site)

## Model

The solver runs directly on a single embedded icosphere. It does not use latitude–longitude coordinates, pole patches, an atlas, or blended chart boundaries.

The GPU state tracks:

- film thickness
- three-dimensional tangential velocity
- insoluble surfactant concentration
- surface temperature

Intrinsic operators use cotangent Laplace–Beltrami weights, dual-edge conservative fluxes, and spherical parallel transport. The derived terms include lubrication gravity/capillary flux, Langmuir surfactant transport, thermal and solutal Marangoni stress, evaporation, and DLVO pressure. A documented partially-mobile-interface closure represents unresolved cross-film shear, surface viscosity, and air coupling; it is kept separate from the published equations and from numerical stabilization.

At `1×`, one model second is exactly one wall-clock second. The solver uses fixed `1/120 s` substeps, so changing display refresh rate cannot change the physics. Speeds above `1×` add more fixed substeps rather than enlarging `dt`.

The renderer converts simulated film thickness to wavelength-dependent thin-film reflectance and combines it with geometric sphere lighting. The optical normal is the sphere normal, so grid-scale thickness variation does not create artificial faceting.

## Interaction

- Adjust physical and optical parameters from the control panel.
- Drag directly on the bubble to disturb the film.
- Hold **Shift** while dragging to orbit the camera.
- Use presets to explore drainage, convection, and black-film regimes.

## Development

Requires Node.js `>=22.13.0`.

```bash
npm ci
npm run dev
```

Useful checks:

```bash
npm run lint
npm run test:solver
npm run analyze:solver
npm test
```

`test:solver` verifies the real-time clock, closed-manifold topology, sphere area, the Laplace–Beltrami spectrum, and area-weighted flux conservation. `analyze:solver` emits mesh/clock metrics as JSON.

For GPU and visual time-series diagnostics, open:

```text
/?diagnostics=1&captures=0,2,5,10,20,40
```

The page exposes `window.__bubbleFilmLab` with `setParameters`, `setPreset`, `pause`, `resume`, `capture`, and `report`. The report contains area-weighted thickness, thin-area fraction, surface-speed, temperature, surfactant, FPS, GPU timing (when supported), dropped model time, and PNG frames. Readback and PNG capture are absent from the normal render path so measurement does not reduce production frame rate.

## Model references

- Lalli & Giusti, *Thin film modelling of magnetic soap films*, JFM 986 A7 (2024), including non-magnetic soap-film equations, surfactant transport, DLVO pressure, and marginal regeneration: <https://doi.org/10.1017/jfm.2024.335>
- Nitschke, Reuther & Voigt, *Discrete exterior calculus (DEC) for the surface Navier–Stokes equation* (2017): <https://arxiv.org/abs/1611.04392>
- Jagad et al., *An Energy-Preserving Discretization for the Poisson Systems Arising in the Primitive Equations* (2020): <https://arxiv.org/abs/2010.15520>
- Seychelles et al., *Thermal Convection and Emergence of Isolated Vortices in Soap Bubbles*, PRL 100, 144501 (2008): <https://doi.org/10.1103/PhysRevLett.100.144501>
- Adami & Caps, *Capillary-driven two-dimensional buoyancy in vertical soap films* (2014): <https://doi.org/10.1209/0295-5075/106/46001>

Marginal regeneration is boundary-sensitive: experiments and the 2024 model obtain thin rising patches through capillary exchange with a meniscus. A mathematically closed free sphere has no meniscus, so this simulator does not label a hidden source/sink as first-principles physics. Persistent activity instead comes from the explicitly identified air-side thermal/evaporation boundary closure and from user interaction.

The application has no authentication, database, analytics, uploaded data, or persistent user state. Simulation state exists only in the browser's GPU memory and resets with the page.

## Deployment

The public source of truth is this GitHub repository. Production is deployed through ChatGPT Sites from the same validated source revision.
