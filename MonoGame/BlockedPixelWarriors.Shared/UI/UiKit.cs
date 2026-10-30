using BlockedPixelWarriors.Assets;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.UI;

/// <summary>
/// 2D drawing helpers for the HUD (the web HUD is HTML/CSS): rounded panels (9-slice of a
/// generated texture), outlines, circles, gradients and text with shadows. Everything is drawn
/// in back-buffer pixels; <see cref="Scale"/> converts CSS pixels of the web layout.
/// </summary>
public sealed class UiKit : IDisposable
{
    private readonly GraphicsDevice _device;
    private readonly Texture2D _round, _ring, _disc, _discSoft, _white, _vignette, _damage;
    private const int RoundSize = 64, RoundRadius = 24;

    public SpriteBatch Batch { get; }
    public BitmapFont Hud { get; }
    public BitmapFont Ui { get; }
    public BitmapFont Mono { get; }
    public BitmapFont Serif { get; }
    public float Scale { get; set; } = 1;
    public Texture2D White => _white;

    public UiKit(GraphicsDevice device, AssetStore assets)
    {
        _device = device;
        Batch = new SpriteBatch(device);
        Hud = assets.Font("font_hud");
        Ui = assets.Font("font_ui");
        Mono = assets.Font("font_mono");
        Serif = assets.Font("font_serif");
        _white = assets.White;
        _round = Generate(RoundSize, (x, y) => RoundedCoverage(x, y, RoundSize, RoundRadius, 0));
        _ring = Generate(RoundSize, (x, y) => RoundedCoverage(x, y, RoundSize, RoundRadius, 3));
        _disc = Generate(128, (x, y) => MathHelper.Clamp(64 - Dist(x, y, 64, 64) + 0.5f, 0, 1));
        _discSoft = Generate(128, (x, y) => MathF.Pow(MathHelper.Clamp(1 - Dist(x, y, 64, 64) / 64, 0, 1), 1.5f));
        // Overlay darkening (radial: clear centre, darker edges).
        _vignette = Generate(256, (x, y) => MathHelper.Clamp(Dist(x, y, 128, 128) / 181f, 0, 1));
        _damage = DamageTexture();
    }

    /// <summary>
    /// Blocked-style damage vignette (hud.css .damage-vignette): transparent centre, red ring,
    /// dark red rim. Baked premultiplied so it can be faded with a single alpha.
    /// </summary>
    private Texture2D DamageTexture()
    {
        const int size = 256;
        var data = new Color[size * size];
        (float stop, Vector4 c)[] stops =
        {
            (0.3f, new Vector4(0, 0, 0, 0)), (0.55f, new Vector4(150, 0, 0, 0.2f)), (0.84f, new Vector4(200, 0, 0, 0.66f)), (1f, new Vector4(60, 0, 0, 0.85f)),
        };
        for (var y = 0; y < size; y++)
        for (var x = 0; x < size; x++)
        {
            // ellipse at center, farthest-corner: d = 1 at the corners.
            var d = Dist(x, y, size / 2f, size / 2f) / (size / 2f * MathF.Sqrt(2));
            var c = stops[^1].c;
            if (d <= stops[0].stop) c = stops[0].c;
            else
            {
                for (var i = 1; i < stops.Length; i++)
                {
                    if (d > stops[i].stop) continue;
                    c = Vector4.Lerp(stops[i - 1].c, stops[i].c, (d - stops[i - 1].stop) / (stops[i].stop - stops[i - 1].stop));
                    break;
                }
            }
            data[y * size + x] = new Color(c.X / 255f * c.W, 0, 0, c.W);
        }
        var t = new Texture2D(_device, size, size, false, SurfaceFormat.Color);
        t.SetData(data);
        return t;
    }

    public void DamageVignette(Rectangle viewport, float alpha) =>
        Batch.Draw(_damage, new Rectangle(viewport.X, viewport.Y, viewport.Width, viewport.Height), Color.White * alpha);

    private static float Dist(float x, float y, float cx, float cy) => MathF.Sqrt((x + 0.5f - cx) * (x + 0.5f - cx) + (y + 0.5f - cy) * (y + 0.5f - cy));

    private static float RoundedCoverage(int x, int y, int size, int radius, float ring)
    {
        float px = x + 0.5f, py = y + 0.5f;
        var cx = MathHelper.Clamp(px, radius, size - radius);
        var cy = MathHelper.Clamp(py, radius, size - radius);
        var d = MathF.Sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
        var outer = MathHelper.Clamp(radius - d + 0.5f, 0, 1);
        if (ring <= 0) return outer;
        var inner = MathHelper.Clamp(radius - ring - d + 0.5f, 0, 1);
        // Straight edges: inner is 1 away from the border.
        var edge = MathF.Min(MathF.Min(px, size - px), MathF.Min(py, size - py));
        if (px > radius && px < size - radius || py > radius && py < size - radius) inner = MathHelper.Clamp(edge - ring + 0.5f, 0, 1);
        return MathF.Max(0, outer - inner);
    }

    private Texture2D Generate(int size, Func<int, int, float> alpha)
    {
        var data = new Color[size * size];
        for (var y = 0; y < size; y++)
        for (var x = 0; x < size; x++)
        {
            var a = alpha(x, y);
            data[y * size + x] = new Color(a, a, a, a); // premultiplied white
        }
        var t = new Texture2D(_device, size, size, false, SurfaceFormat.Color);
        t.SetData(data);
        return t;
    }

    public void Begin() => Batch.Begin(SpriteSortMode.Deferred, BlendState.AlphaBlend, SamplerState.LinearClamp, DepthStencilState.None, RasterizerState.CullNone);

    public void End() => Batch.End();

    public void Rect(RectangleF r, Color c) => Batch.Draw(_white, r.ToVector(), null, c, 0, Vector2.Zero, r.Size, SpriteEffects.None, 0);

    /// <summary>Rounded panel (radius in pixels), 9-slice of the generated texture.</summary>
    public void Panel(RectangleF r, float radius, Color fill) => NineSlice(_round, r, radius, fill);

    public void Outline(RectangleF r, float radius, Color color) => NineSlice(_ring, r, radius, color);

    private void NineSlice(Texture2D tex, RectangleF r, float radius, Color color)
    {
        radius = MathF.Min(radius, MathF.Min(r.Width, r.Height) / 2);
        if (radius < 0.5f)
        {
            Rect(r, color);
            return;
        }
        const int c = RoundRadius;
        const int m = RoundSize - 2 * c;
        float[] xs = { r.X, r.X + radius, r.Right - radius, r.Right };
        float[] ys = { r.Y, r.Y + radius, r.Bottom - radius, r.Bottom };
        int[] sx = { 0, c, c + m, RoundSize };
        for (var j = 0; j < 3; j++)
        for (var i = 0; i < 3; i++)
        {
            var w = xs[i + 1] - xs[i];
            var h = ys[j + 1] - ys[j];
            if (w <= 0 || h <= 0) continue;
            var src = new Rectangle(sx[i], sx[j], sx[i + 1] - sx[i], sx[j + 1] - sx[j]);
            Batch.Draw(tex, new Vector2(xs[i], ys[j]), src, color, 0, Vector2.Zero, new Vector2(w / src.Width, h / src.Height), SpriteEffects.None, 0);
        }
    }

    public void Disc(Vector2 center, float radius, Color color) =>
        Batch.Draw(_disc, center, null, color, 0, new Vector2(64, 64), radius / 64f, SpriteEffects.None, 0);

    public void SoftDisc(Vector2 center, float radius, Color color) =>
        Batch.Draw(_discSoft, center, null, color, 0, new Vector2(64, 64), radius / 64f, SpriteEffects.None, 0);

    public void Ring(Vector2 center, float radius, float thickness, Color color)
    {
        // Thin ring: outer disc minus... drawn as many short segments (cheap enough for a few rings).
        const int n = 48;
        for (var i = 0; i < n; i++)
        {
            var a0 = i * MathF.PI * 2 / n;
            var a1 = (i + 1) * MathF.PI * 2 / n;
            Line(center + new Vector2(MathF.Cos(a0), MathF.Sin(a0)) * radius, center + new Vector2(MathF.Cos(a1), MathF.Sin(a1)) * radius, thickness, color);
        }
    }

    public void Line(Vector2 a, Vector2 b, float thickness, Color color)
    {
        var d = b - a;
        var len = d.Length();
        if (len < 0.01f) return;
        Batch.Draw(_white, a, null, color, MathF.Atan2(d.Y, d.X), new Vector2(0, 0.5f), new Vector2(len, thickness), SpriteEffects.None, 0);
    }

    public void Vignette(Rectangle viewport, Color color) =>
        Batch.Draw(_vignette, new Rectangle(viewport.X, viewport.Y, viewport.Width, viewport.Height), color);

    public void Texture(Texture2D t, RectangleF r, Color color) =>
        Batch.Draw(t, r.ToVector(), null, color, 0, Vector2.Zero, new Vector2(r.Width / t.Width, r.Height / t.Height), SpriteEffects.None, 0);

    /// <summary>Text with a solid drop shadow (CSS text-shadow: 0 Npx 0 dark).</summary>
    public void Text(BitmapFont font, string text, Vector2 pos, float px, Color color, float shadow = 0, float spacing = 0)
    {
        if (shadow > 0) font.Draw(Batch, text, pos + new Vector2(0, shadow), px, new Color(0x1b, 0x1d, 0x21) * (color.A / 255f), spacing);
        font.Draw(Batch, text, pos, px, color, spacing);
    }

    public void TextCentered(BitmapFont font, string text, Vector2 center, float px, Color color, float shadow = 0, float spacing = 0)
    {
        var w = font.Measure(text, px, spacing);
        Text(font, text, new Vector2(center.X - w / 2, center.Y - px * 0.5f), px, color, shadow, spacing);
    }

    public void Dispose()
    {
        Batch.Dispose();
        _round.Dispose();
        _ring.Dispose();
        _disc.Dispose();
        _discSoft.Dispose();
        _vignette.Dispose();
        _damage.Dispose();
    }
}

/// <summary>Float rectangle (UI layout in pixels).</summary>
public struct RectangleF
{
    public float X, Y, Width, Height;

    public RectangleF(float x, float y, float w, float h)
    {
        X = x;
        Y = y;
        Width = w;
        Height = h;
    }

    public float Right => X + Width;
    public float Bottom => Y + Height;
    public Vector2 Center => new(X + Width / 2, Y + Height / 2);
    public Vector2 Size => new(Width, Height);
    public Vector2 ToVector() => new(X, Y);
    public bool Contains(Vector2 p) => p.X >= X && p.X <= Right && p.Y >= Y && p.Y <= Bottom;
    public static implicit operator RectangleF(Rectangle r) => new(r.X, r.Y, r.Width, r.Height);
}
