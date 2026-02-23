"""
Discrete Flow Maps — Mean Denoiser Animation
─────────────────────────────────────────────
Run:  manim -pqh mean_denoiser.py MeanDenoiserScene
      manim -pql mean_denoiser.py MeanDenoiserScene   (low quality preview)

Requires: manim (community edition)
    pip install manim
"""

from manim import *
import numpy as np

# ══════════════════════════════════════════════════════════════
#  Colors
# ══════════════════════════════════════════════════════════════
BG_COLOR     = "#ffffff"
INK_COLOR    = "#2e4552"
TEAL         = "#2f533f"
MAROON       = "#965c58"
DKBLUE       = INK_COLOR
LTBLUE       = TEAL
PURPLE       = TEAL
SIMPLEX_FILL = "#f2eee0"
SIMPLEX_EDGE = INK_COLOR
DASHED_BLUE  = TEAL
BOX_EDGE     = "#c3c3c3"
BOX_FILL     = "#f2eee0"
NARR_COLOR   = INK_COLOR   # narrative text color

# ══════════════════════════════════════════════════════════════
#  Geometry — both simplices share the same vertical plane
# ══════════════════════════════════════════════════════════════
TRI_BASE = 3.6
TRI_H    = 2.8

BASE_Y = -0.6
TOP_Y  = BASE_Y + TRI_H   # 2.2

LCX = -3.5
L_FOX  = np.array([LCX - TRI_BASE/2, BASE_Y, 0])
L_CAT  = np.array([LCX + TRI_BASE/2, BASE_Y, 0])
L_DOG  = np.array([LCX,              TOP_Y,  0])

RCX = 3.5
R_FOX  = np.array([RCX - TRI_BASE/2, BASE_Y, 0])
R_CAT  = np.array([RCX + TRI_BASE/2, BASE_Y, 0])
R_DOG  = np.array([RCX,              TOP_Y,  0])

# Probabilities — shifted toward cat so the dot sits further right
# and doesn't overlap the P(...) label near fox
P_FOX, P_DOG, P_CAT = 0.32, 0.14, 0.54

# Narrative text y-position (bottom of frame)
NARR_Y = -3.68
TIME_SCALE = 1.15


def bary(p1, p2, p3, w1, w2, w3):
    """Barycentric coords → cartesian."""
    return w1 * p1 + w2 * p2 + w3 * p3


def lerp(a, b, t):
    return (1 - t) * a + t * b


def narr_tex(text):
    """Create narrative Tex mob (supports LaTeX) at the bottom of the frame."""
    t = Tex(text, font_size=28, color=NARR_COLOR)
    t.move_to(np.array([0, NARR_Y, 0]))
    return t


config.background_color = BG_COLOR


class MeanDenoiserScene(Scene):
    def play(self, *args, **kwargs):
        if "run_time" in kwargs:
            kwargs["run_time"] = kwargs["run_time"] * TIME_SCALE
        return super().play(*args, **kwargs)

    def wait(self, duration=DEFAULT_WAIT_TIME, stop_condition=None):
        return super().wait(duration * TIME_SCALE, stop_condition=stop_condition)

    def construct(self):
        self.narr = None  # current narrative mob

        # ── ACT 1 ──
        self.act1_instantaneous_denoiser()
        self.wait(1.0)

        # ── ACT 2 ──
        self.act2_mean_denoiser_motivation()
        self.wait(1.0)

        # ── ACT 3 ──
        self.act3_trajectory_and_projection()
        self.wait(1.0)

        # ── ACT 4 ──
        self.act4_flow_map_equation()
        self.wait(2.0)

    # ─────────────────────────────────────────────────────────
    #  Narrative helpers
    # ─────────────────────────────────────────────────────────
    def show_narr(self, text, run_time=0.6):
        """Swap current narrative text for a new one."""
        new = narr_tex(text)
        if self.narr is None:
            self.play(FadeIn(new), run_time=run_time)
        else:
            self.play(FadeOut(self.narr), FadeIn(new), run_time=run_time)
        self.narr = new

    def hide_narr(self, run_time=0.4):
        if self.narr is not None:
            self.play(FadeOut(self.narr), run_time=run_time)
            self.narr = None

    # ══════════════════════════════════════════════════════════
    #  ACT 1
    # ══════════════════════════════════════════════════════════
    def act1_instantaneous_denoiser(self):
        """Draw left simplex, weighted lines to ψ_{s,s}, equation."""

        # --- Triangle ---
        tri = Polygon(L_FOX, L_DOG, L_CAT,
                      fill_color=SIMPLEX_FILL, fill_opacity=0.5,
                      stroke_color=SIMPLEX_EDGE, stroke_width=3)

        lbl_fox = Text("fox", font_size=28, weight=BOLD, color=INK_COLOR
                       ).next_to(L_FOX, LEFT, buff=0.15)
        lbl_dog = Text("dog", font_size=28, weight=BOLD, color=INK_COLOR
                       ).next_to(L_DOG, UP, buff=0.15)
        lbl_cat = Text("cat", font_size=28, weight=BOLD, color=INK_COLOR
                       ).next_to(L_CAT, RIGHT, buff=0.15)

        vec_fox = MathTex(r"\begin{pmatrix}1\\0\\0\end{pmatrix}",
                          font_size=26, color=INK_COLOR
                          ).next_to(lbl_fox, DOWN, buff=0.05)
        vec_dog = MathTex(r"\begin{pmatrix}0\\1\\0\end{pmatrix}",
                          font_size=26, color=INK_COLOR
                          ).next_to(lbl_dog, UP, buff=0.05)
        vec_cat = MathTex(r"\begin{pmatrix}0\\0\\1\end{pmatrix}",
                          font_size=26, color=INK_COLOR
                          ).next_to(lbl_cat, DOWN, buff=0.05)

        # --- Black dots at vertices ---
        dot_fox = Dot(L_FOX, radius=0.07, color=INK_COLOR, z_index=4)
        dot_dog = Dot(L_DOG, radius=0.07, color=INK_COLOR, z_index=4)
        dot_cat = Dot(L_CAT, radius=0.07, color=INK_COLOR, z_index=4)

        # --- ψ_{s,s} (now closer to cat side) ---
        psi_ss_pos = bary(L_FOX, L_DOG, L_CAT, P_FOX, P_DOG, P_CAT)
        psi_ss_dot = Dot(psi_ss_pos, radius=0.08, color=TEAL, z_index=5)
        psi_ss_lbl = MathTex(r"\psi_{s,s}", font_size=34, color=TEAL
                             ).next_to(psi_ss_pos, UR, buff=0.12)

        # --- Weighted lines ---
        max_w = 8.0
        line_fox = Line(L_FOX, psi_ss_pos, stroke_width=max_w * P_FOX,
                        stroke_color=LTBLUE, stroke_opacity=0.7)
        line_dog = Line(L_DOG, psi_ss_pos, stroke_width=max_w * P_DOG,
                        stroke_color=LTBLUE, stroke_opacity=0.7)
        line_cat = Line(L_CAT, psi_ss_pos, stroke_width=max_w * P_CAT,
                        stroke_color=LTBLUE, stroke_opacity=0.7)

        p1_lbl = MathTex(r"p_1", font_size=24, color=DKBLUE
                         ).move_to(lerp(L_FOX, psi_ss_pos, 0.46) + UP * 0.20)
        p2_lbl = MathTex(r"p_2", font_size=24, color=DKBLUE
                         ).move_to(lerp(L_DOG, psi_ss_pos, 0.42) + LEFT * 0.18)
        p3_lbl = MathTex(r"p_3", font_size=24, color=DKBLUE
                         ).move_to(lerp(L_CAT, psi_ss_pos, 0.48) + UP * 0.18)

        # --- Equation below LEFT simplex ---
        eq_psi_ss = MathTex(
            r"\psi_{s,s}(x)",
            r"= \sum_{i=1}^{3}",
            r"\underbrace{\mathbb{P}(I_1 = e_i \mid I_s = x)}_{p_i}\, e_i",
            font_size=28, color=INK_COLOR
        ).move_to(np.array([LCX, BASE_Y - 1.6, 0]))
        eq_psi_ss[0].set_color(TEAL)

        eq_psi_ss2 = MathTex(
            r"= \mathbb{E}[I_1 \mid I_s = x]",
            font_size=28, color=INK_COLOR
        ).next_to(eq_psi_ss[1], DOWN, buff=0.15, aligned_edge=LEFT)

        # --- Animate ---
        self.show_narr("The simplex has one vertex per item in the vocabulary.")
        self.play(Create(tri), run_time=1.0)
        self.play(
            FadeIn(dot_fox), FadeIn(dot_dog), FadeIn(dot_cat),
            FadeIn(lbl_fox), FadeIn(lbl_dog), FadeIn(lbl_cat),
            FadeIn(vec_fox), FadeIn(vec_dog), FadeIn(vec_cat),
            run_time=0.8
        )
        self.wait(0.5)

        self.show_narr(
            r"The weighted sum of posterior probabilities of each vertex is the instantaneous denoiser $\psi_{s,s}$."
        )
        self.play(
            Create(line_fox), Create(line_dog), Create(line_cat),
            run_time=1.0
        )
        self.play(FadeIn(p1_lbl), FadeIn(p2_lbl), FadeIn(p3_lbl), run_time=0.6)
        self.wait(0.3)

        self.play(
            GrowFromCenter(psi_ss_dot), FadeIn(psi_ss_lbl),
            run_time=0.8
        )
        self.wait(0.5)
        self.play(Write(eq_psi_ss), run_time=1.2)
        self.play(Write(eq_psi_ss2), run_time=0.8)
        self.wait(1.0)

        # Store
        self.left_group = VGroup(
            tri, lbl_fox, lbl_dog, lbl_cat, vec_fox, vec_dog, vec_cat,
            line_fox, line_dog, line_cat, p1_lbl, p2_lbl, p3_lbl,
            psi_ss_dot, psi_ss_lbl
        )
        self.eq_psi_ss = VGroup(eq_psi_ss, eq_psi_ss2)
        self.psi_ss_left_pos = psi_ss_pos
        self.psi_ss_left_dot = psi_ss_dot
        self.psi_ss_left_lbl = psi_ss_lbl

    # ══════════════════════════════════════════════════════════
    #  ACT 2
    # ══════════════════════════════════════════════════════════
    def act2_mean_denoiser_motivation(self):
        """Transition: motivate ψ_{s,t} as weighted average."""

        title_box_center = np.array([0, TOP_Y + 0.6, 0])

        title = MathTex(
            r"\textbf{Mean denoiser }",
            r"\psi_{s,t}",
            r"\in \Delta^{K-1}",
            font_size=32, color=INK_COLOR
        ).move_to(title_box_center)
        title[1].set_color(TEAL)

        eq_mean = MathTex(
            r"\psi_{s,t}(x_s)",
            r"= \int_s^t w(u)\,",
            r"\mathbb{E}[I_1 \mid I_u = x_u]",
            r"\, du",
            font_size=28, color=INK_COLOR
        ).next_to(title, DOWN, buff=0.25)
        eq_mean[0].set_color(TEAL)

        title_eq_group = VGroup(title, eq_mean)
        title_box = SurroundingRectangle(
            title_eq_group, color=BOX_EDGE, fill_color=BOX_FILL,
            fill_opacity=0.95, buff=0.25, corner_radius=0.12
        )

        eq_weight = MathTex(
            r"w(u) = \frac{(1-s)(1-t)}{(t-s)(1-u)^2}",
            font_size=26, color=PURPLE
        ).next_to(title_box, DOWN, buff=0.2)

        self.show_narr("The mean denoiser averages instantaneous denoisers along the ODE trajectory.")
        self.play(
            FadeIn(title_box), FadeIn(title), FadeIn(eq_mean),
            run_time=1.2
        )
        self.play(FadeIn(eq_weight), run_time=0.8)
        self.wait(1.5)

        self.title_box = title_box
        self.title_group = VGroup(title_box, title, eq_mean)
        self.eq_weight = eq_weight

    # ══════════════════════════════════════════════════════════
    #  ACT 3
    # ══════════════════════════════════════════════════════════
    def act3_trajectory_and_projection(self):
        """Right simplex, trajectory, tangent → ψ_{s,s}, sweep → ψ_{s,t}."""

        # --- Right simplex ---
        tri_r = Polygon(R_FOX, R_DOG, R_CAT,
                        fill_color=SIMPLEX_FILL, fill_opacity=0.5,
                        stroke_color=SIMPLEX_EDGE, stroke_width=3)

        lbl_fox_r = Text("fox", font_size=26, weight=BOLD, color=INK_COLOR
                         ).next_to(R_FOX, LEFT, buff=0.12)
        lbl_dog_r = Text("dog", font_size=26, weight=BOLD, color=INK_COLOR
                         ).next_to(R_DOG, UP, buff=0.12)
        lbl_cat_r = Text("cat", font_size=26, weight=BOLD, color=INK_COLOR
                         ).next_to(R_CAT, RIGHT, buff=0.12)

        vec_fox_r = MathTex(r"\begin{pmatrix}1\\0\\0\end{pmatrix}",
                            font_size=24, color=INK_COLOR
                            ).next_to(lbl_fox_r, DOWN, buff=0.05)
        vec_dog_r = MathTex(r"\begin{pmatrix}0\\1\\0\end{pmatrix}",
                            font_size=24, color=INK_COLOR
                            ).next_to(lbl_dog_r, UP, buff=0.05)
        vec_cat_r = MathTex(r"\begin{pmatrix}0\\0\\1\end{pmatrix}",
                            font_size=24, color=INK_COLOR
                            ).next_to(lbl_cat_r, DOWN, buff=0.05)

        # Black dots at vertices
        dot_fox_r = Dot(R_FOX, radius=0.07, color=INK_COLOR, z_index=4)
        dot_dog_r = Dot(R_DOG, radius=0.07, color=INK_COLOR, z_index=4)
        dot_cat_r = Dot(R_CAT, radius=0.07, color=INK_COLOR, z_index=4)

        self.show_narr("A second simplex shows the trajectory of the generative ODE.")
        self.play(Create(tri_r), run_time=0.8)
        self.play(
            FadeIn(dot_fox_r), FadeIn(dot_dog_r), FadeIn(dot_cat_r),
            FadeIn(lbl_fox_r), FadeIn(lbl_dog_r), FadeIn(lbl_cat_r),
            FadeIn(vec_fox_r), FadeIn(vec_dog_r), FadeIn(vec_cat_r),
            run_time=0.5
        )

        # ── Trajectory: gentle curve, centered below base edge,
        #    bows slightly right, then bends smoothly into fox vertex ──
        x0_pos = np.array([RCX, BASE_Y - 2.6, 0])   # centered below triangle
        x1_pos = R_FOX.copy()                         # ends at fox (bottom-left)

        # Single cubic Bezier: soften the bend so secants read more cleanly.
        traj_curve = CubicBezier(
            x0_pos,
            x0_pos + np.array([1.1, 1.0, 0]),     # pull right-up
            x1_pos + np.array([1.3, -1.2, 0]),    # approach fox from below-right
            x1_pos
        )
        traj_curve.set_stroke(color=BLACK, width=4.5)

        # Place x_s earlier so the secant x_s -> x_t extends cleanly to ψ_{s,t}.
        xs_param = 0.20
        xt_param = 0.50
        xs_on_curve = traj_curve.point_from_proportion(xs_param)
        xt_on_curve = traj_curve.point_from_proportion(xt_param)

        # Dots + labels
        x0_dot = Dot(x0_pos, radius=0.06, color=MAROON, z_index=5)
        x0_lbl = MathTex(r"x_0", font_size=30, color=MAROON
                         ).next_to(x0_pos, DOWN, buff=0.1)

        xs_dot = Dot(xs_on_curve, radius=0.06, color=MAROON, z_index=5)
        xs_lbl = MathTex(r"x_s", font_size=30, color=MAROON
                         ).next_to(xs_on_curve, RIGHT, buff=0.12)

        xt_dot = Dot(xt_on_curve, radius=0.06, color=MAROON, z_index=5)
        xt_lbl = MathTex(r"x_t", font_size=30, color=MAROON
                         ).next_to(xt_on_curve, LEFT, buff=0.15)

        x1_lbl = MathTex(r"x_1", font_size=30, color=MAROON
                         ).next_to(dot_fox_r, DOWN, buff=0.12)

        self.show_narr("The generative ODE traces a path from random noise to a token vertex.")
        self.play(Create(traj_curve), run_time=1.5)
        self.play(
            FadeIn(x0_dot), FadeIn(x0_lbl),
            FadeIn(xs_dot), FadeIn(xs_lbl),
            FadeIn(xt_dot), FadeIn(xt_lbl),
            FadeIn(x1_lbl),
            run_time=0.8
        )
        self.wait(0.5)

        # --- ψ_{s,s} on right simplex ---
        psi_ss_r_pos = bary(R_FOX, R_DOG, R_CAT, P_FOX, P_DOG, P_CAT)
        psi_ss_r_dot = Dot(psi_ss_r_pos, radius=0.07, color=TEAL, z_index=5)
        psi_ss_r_lbl = MathTex(r"\psi_{s,s}", font_size=30, color=TEAL
                               ).next_to(psi_ss_r_pos, RIGHT, buff=0.12)

        # --- Tangent line at x_s ---
        eps = 0.005
        tang_dir = (traj_curve.point_from_proportion(xs_param + eps)
                    - traj_curve.point_from_proportion(xs_param - eps))
        tang_dir = tang_dir / np.linalg.norm(tang_dir)
        # Keep the displayed tangent aimed through ψ_{s,s} for visual alignment.
        psi_dir = psi_ss_r_pos - xs_on_curve
        if np.linalg.norm(psi_dir) > 1e-6:
            tang_dir = psi_dir / np.linalg.norm(psi_dir)
        tang_len = 0.8
        tang_line = Line(
            xs_on_curve - tang_len * tang_dir,
            xs_on_curve + tang_len * tang_dir,
            stroke_color=TEAL, stroke_width=3.5
        )

        # Dashed projection from x_s up to ψ_{s,s}
        dash_xs_psi = DashedLine(
            xs_on_curve, psi_ss_r_pos,
            stroke_color=DASHED_BLUE, stroke_width=2.8, dash_length=0.12
        )

        self.show_narr(r"The tangent at $x_s$ projects onto the simplex at the instantaneous denoiser.")
        self.play(Create(tang_line), run_time=0.8)
        self.play(
            Create(dash_xs_psi),
            GrowFromCenter(psi_ss_r_dot),
            FadeIn(psi_ss_r_lbl),
            run_time=1.0
        )
        self.wait(0.5)

        # Flash highlight on left ψ_{s,s}
        flash_rect = SurroundingRectangle(
            VGroup(self.psi_ss_left_dot, self.psi_ss_left_lbl),
            color=TEAL, buff=0.15
        )
        self.play(Create(flash_rect), run_time=0.5)
        self.play(FadeOut(flash_rect), run_time=0.5)

        # --- Sweep dot x_s → x_t, project ψ_{s,t} on simplex ---
        # Place ψ_{s,t} on the forward extension of the secant x_s → x_t,
        # then push slightly into the simplex interior for readability.
        secant_vec = xt_on_curve - xs_on_curve
        secant_dir = secant_vec / np.linalg.norm(secant_vec)
        if abs(secant_dir[1]) > 1e-6:
            alpha_to_base = (BASE_Y - xt_on_curve[1]) / secant_dir[1]
            psi_st_target = xt_on_curve + (alpha_to_base + 0.35) * secant_dir
        else:
            # Fallback for near-horizontal secants.
            psi_st_target = bary(R_FOX, R_DOG, R_CAT, 0.60, 0.15, 0.25)

        # Pre-compute a smooth Bezier path on the simplex: psi_ss → psi_st → fox
        # This replaces TracedPath for a cleaner, smooth curve.
        psi_mid = bary(R_FOX, R_DOG, R_CAT, 0.50, 0.18, 0.32)  # intermediate control
        simplex_path_1 = CubicBezier(
            psi_ss_r_pos,
            lerp(psi_ss_r_pos, psi_mid, 0.5),
            lerp(psi_mid, psi_st_target, 0.5),
            psi_st_target
        )
        simplex_path_1.set_stroke(color=TEAL, width=3.0, opacity=0.6)

        simplex_path_2 = CubicBezier(
            psi_st_target,
            lerp(psi_st_target, bary(R_FOX, R_DOG, R_CAT, 0.70, 0.12, 0.18), 0.5),
            lerp(bary(R_FOX, R_DOG, R_CAT, 0.80, 0.08, 0.12), R_FOX, 0.5),
            R_FOX.copy()
        )
        simplex_path_2.set_stroke(color=TEAL, width=3.0, opacity=0.4)

        moving_dot = Dot(xs_on_curve, radius=0.08, color=MAROON, z_index=6)
        psi_st_dot = Dot(psi_ss_r_pos.copy(), radius=0.08, color=TEAL, z_index=6)
        psi_st_lbl = MathTex(r"\psi_{s,t}", font_size=30, color=TEAL
                             ).next_to(psi_st_target, LEFT, buff=0.12)

        dash_moving = always_redraw(lambda: DashedLine(
            moving_dot.get_center(), psi_st_dot.get_center(),
            stroke_color=DASHED_BLUE, stroke_width=2.5, dash_length=0.10
        ))

        self.show_narr(r"As we move along the ODE trajectory, the mean denoiser $\psi_{s,t}$ traces a path on the simplex.")
        self.add(dash_moving)
        self.play(FadeIn(moving_dot), run_time=0.3)

        # Phase 1: x_s → x_t  (psi traces from psi_ss to psi_st)
        self.play(
            moving_dot.animate.move_to(xt_on_curve),
            psi_st_dot.animate.move_to(psi_st_target),
            Create(simplex_path_1),
            run_time=2.0, rate_func=smooth
        )
        self.play(FadeIn(psi_st_lbl), run_time=0.5)
        self.wait(0.3)

        # Leave a persistent dot at ψ_{s,t} before continuing
        psi_st_frozen = Dot(psi_st_target, radius=0.08, color=TEAL, z_index=5)
        self.add(psi_st_frozen)

        # Phase 2: x_t → x_1  (psi traces all the way to fox vertex)
        self.play(
            moving_dot.animate.move_to(x1_pos),
            psi_st_dot.animate.move_to(R_FOX.copy()),
            Create(simplex_path_2),
            run_time=2.0, rate_func=smooth
        )
        self.wait(0.5)

        # --- Secant arrow x_s → x_t ---
        secant_arrow = Arrow(
            xs_on_curve, xt_on_curve,
            stroke_color=MAROON, stroke_width=3.5,
            max_tip_length_to_length_ratio=0.15, buff=0
        )

        self.show_narr(r"The mean denoiser projects the secant line between $x_s$ and $x_t$ onto the simplex.")
        self.play(FadeOut(tang_line), Create(secant_arrow), run_time=1.0)
        self.wait(0.3)

        # Dashed line from x_t up to ψ_{s,t}
        dash_xt_psi = DashedLine(
            xt_on_curve, psi_st_target,
            stroke_color=DASHED_BLUE, stroke_width=2.8, dash_length=0.12
        )
        self.play(Create(dash_xt_psi), run_time=0.8)
        self.wait(0.5)

        self.play(FadeOut(moving_dot), FadeOut(dash_moving), run_time=0.3)

        # Store
        self.right_group = VGroup(
            tri_r, lbl_fox_r, lbl_dog_r, lbl_cat_r,
            vec_fox_r, vec_dog_r, vec_cat_r,
            traj_curve, x0_dot, x0_lbl, xs_dot, xs_lbl, xt_dot, xt_lbl, x1_lbl,
            psi_ss_r_dot, psi_ss_r_lbl, dash_xs_psi,
            psi_st_dot, psi_st_lbl, dash_xt_psi,
            secant_arrow
        )
        self.xs_on_curve = xs_on_curve
        self.xt_on_curve = xt_on_curve
        self.psi_st_target = psi_st_target

    # ══════════════════════════════════════════════════════════
    #  ACT 4
    # ══════════════════════════════════════════════════════════
    def act4_flow_map_equation(self):
        """Show flow map equation X_{s,t} = ... color-coded, centered bottom."""

        self.play(FadeOut(self.eq_weight), run_time=0.5)
        self.hide_narr()

        eq_flow = MathTex(
            r"X_{s,t}(",    # 0
            r"x_s",         # 1
            r") =",         # 2
            r"\frac{1-t}{1-s}",  # 3
            r"x_s",         # 4
            r"+",            # 5
            r"\frac{t-s}{1-s}",  # 6
            r"\psi_{s,t}(x_s)",  # 7  — all one piece
            font_size=34, color=INK_COLOR
        ).move_to(np.array([0, BASE_Y - 2.0, 0]))

        eq_flow[1].set_color(MAROON)   # x_s in X_{s,t}(x_s)
        eq_flow[4].set_color(MAROON)   # x_s coefficient
        eq_flow[7].set_color(TEAL)     # ψ_{s,t}(x_s) fully teal

        eq_box = SurroundingRectangle(
            eq_flow, color=BOX_EDGE, fill_color=BOX_FILL,
            fill_opacity=0.95, buff=0.25, corner_radius=0.12
        )

        self.show_narr(r"The discrete flow map: a convex combination of $x_s$ and the mean denoiser.")
        self.play(FadeIn(eq_box), Write(eq_flow), run_time=1.5)
        self.wait(2.0)
