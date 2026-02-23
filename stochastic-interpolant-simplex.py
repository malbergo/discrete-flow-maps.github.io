"""
Stochastic Interpolant on a Simplex
Run:
    manim -pqh stochastic-interpolant-simplex.py StochasticInterpolantSimplexScene
"""

from manim import *
import numpy as np


INK_COLOR = "#2e4552"
GREEN_1 = "#2f533f"
GREEN_2 = "#3d604c"
GREEN_3 = "#4c6b5a"
SIMPLEX_FILL = "#f2eee0"
CLOUD_COLOR = "#90a0aa"
HIGHLIGHT_X0 = "#e2c77d"
HIGHLIGHT_X1 = "#d7e6d6"


config.background_color = WHITE


def sample_gaussian_ball(rng, n_samples, sigma=0.92, radius=1.95):
    """Sample points from N(0, sigma^2 I) and keep those in a radius-limited ball."""
    points = []
    while len(points) < n_samples:
        batch = rng.normal(loc=0.0, scale=sigma, size=(4 * n_samples, 3))
        kept = batch[np.linalg.norm(batch, axis=1) <= radius]
        points.extend(kept.tolist())
    return np.array(points[:n_samples])


def make_sphere(point, radius, color, opacity=1.0, resolution=(10, 6)):
    sphere = Sphere(center=point, radius=radius, resolution=resolution)
    sphere.set_style(
        fill_color=color,
        fill_opacity=opacity,
        stroke_color=color,
        stroke_opacity=min(0.65, opacity),
        stroke_width=0.6,
    )
    return sphere


class StochasticInterpolantSimplexScene(ThreeDScene):
    def construct(self):
        rng = np.random.default_rng(23)

        self.set_camera_orientation(phi=70 * DEGREES, theta=-42 * DEGREES, zoom=1.0)

        # --- Stage 1: Gaussian x_0 cloud in R^3 around the origin ---
        n_samples = 10
        x0_points = sample_gaussian_ball(rng, n_samples=n_samples, sigma=0.94, radius=1.95)

        axes = ThreeDAxes(
            x_range=[-4, 4, 1],
            y_range=[-4, 4, 1],
            z_range=[-3, 3, 1],
            x_length=8,
            y_length=8,
            z_length=6,
            axis_config={
                "stroke_color": INK_COLOR,
                "stroke_width": 2,
                "stroke_opacity": 0.18,
            },
            tips=False,
        )

        x0_spheres = VGroup(
            *[
                make_sphere(
                    point=p,
                    radius=0.055,
                    color=CLOUD_COLOR,
                    opacity=1.0,
                    resolution=(10, 6),
                )
                for p in x0_points
            ]
        )

        self.play(Create(axes), run_time=0.9)
        self.play(
            LaggedStart(*[FadeIn(s) for s in x0_spheres], lag_ratio=0.015),
            run_time=1.8,
        )

        # Rotate to emphasize 3D Gaussian ball geometry.
        self.begin_ambient_camera_rotation(rate=0.16)
        self.wait(2.8)
        self.stop_ambient_camera_rotation()
        self.wait(0.2)

        # --- Stage 2: simplex in x-y plane and weighted endpoint distribution ---
        simplex_radius = 3.2
        angles = [PI / 2, PI / 2 + 2 * PI / 3, PI / 2 + 4 * PI / 3]
        vertices = [
            np.array([simplex_radius * np.cos(a), simplex_radius * np.sin(a), 0.0])
            for a in angles
        ]
        endpoint_colors = [GREEN_1, GREEN_2, GREEN_3]
        weights = rng.dirichlet(np.array([1.55, 1.2, 1.0]))

        simplex = Polygon(
            vertices[0],
            vertices[1],
            vertices[2],
            stroke_color=INK_COLOR,
            stroke_width=4,
            fill_color=SIMPLEX_FILL,
            fill_opacity=0.46,
        )

        vertex_spheres = VGroup(
            *[
                make_sphere(
                    point=v,
                    radius=0.11,
                    color=INK_COLOR,
                    opacity=1.0,
                    resolution=(14, 8),
                )
                for v in vertices
            ]
        )

        self.play(Create(simplex), FadeIn(vertex_spheres), run_time=1.0)

        self.begin_ambient_camera_rotation(rate=0.06)

        n_rounds = 11
        pairs_per_round = 3
        faint_lines = VGroup()

        for _ in range(n_rounds):
            sample_ids = rng.choice(n_samples, size=pairs_per_round, replace=False)
            vertex_ids = rng.choice(3, size=pairs_per_round, p=weights)

            glows = VGroup()
            active_lines = []
            movers = VGroup()

            for sample_id, vertex_id in zip(sample_ids, vertex_ids):
                x0 = x0_points[sample_id]
                x1 = vertices[vertex_id]
                line_color = endpoint_colors[vertex_id]

                glows.add(
                    make_sphere(
                        point=x0,
                        radius=0.10,
                        color=HIGHLIGHT_X0,
                        opacity=0.40,
                        resolution=(10, 6),
                    )
                )
                glows.add(
                    make_sphere(
                        point=x1,
                        radius=0.17,
                        color=HIGHLIGHT_X1,
                        opacity=0.36,
                        resolution=(14, 8),
                    )
                )

                line = Line(
                    x0,
                    x1,
                    stroke_color=line_color,
                    stroke_width=3.2,
                    stroke_opacity=0.95,
                )
                active_lines.append(line)

                movers.add(
                    make_sphere(
                        point=x0,
                        radius=0.050,
                        color=line_color,
                        opacity=1.0,
                        resolution=(10, 6),
                    )
                )

            self.play(FadeIn(glows), run_time=0.26)
            self.add(movers)
            self.play(
                *[Create(line) for line in active_lines],
                *[
                    movers[i].animate.move_to(vertices[vertex_ids[i]])
                    for i in range(pairs_per_round)
                ],
                run_time=1.3,
                rate_func=smooth,
            )

            # Keep subtle trajectory traces after each batch.
            self.play(
                *[
                    active_lines[i].animate.set_stroke(width=1.6, opacity=0.26)
                    for i in range(pairs_per_round)
                ],
                FadeOut(glows),
                FadeOut(movers),
                run_time=0.35,
            )
            faint_lines.add(*active_lines)

        # Midpoint snapshot of I_t cloud for a fixed t.
        t_mid = 0.50
        midpoint_markers = VGroup()
        for _ in range(42):
            sample_id = rng.integers(0, n_samples)
            vertex_id = rng.choice(3, p=weights)
            p0 = x0_points[sample_id]
            p1 = vertices[vertex_id]
            midpoint_markers.add(
                make_sphere(
                    point=interpolate(p0, p1, t_mid),
                    radius=0.032,
                    color=endpoint_colors[vertex_id],
                    opacity=0.94,
                    resolution=(8, 5),
                )
            )

        self.play(FadeIn(midpoint_markers), run_time=0.9)
        self.wait(2.0)
        self.stop_ambient_camera_rotation()
        self.wait(0.6)
