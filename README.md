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

Intrinsic operators use cotangent Laplace–Beltrami weights, dual-edge conservative fluxes, and spherical parallel transport. Forces include gravity-driven drainage, capillarity, viscosity, thermal and surfactant Marangoni stresses, evaporation, and surface diffusion.

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
npm test
```

The application has no authentication, database, analytics, uploaded data, or persistent user state. Simulation state exists only in the browser's GPU memory and resets with the page.

## Deployment

The public source of truth is this GitHub repository. Production is deployed through ChatGPT Sites from the same validated source revision.
