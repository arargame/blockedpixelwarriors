using System.Text.Json;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Assets;

/// <summary>
/// Bitmap font atlas exported from the browser (same fonts as the web HUD). Drawn with
/// SpriteBatch; scale = pixel height / atlas size. Glyphs are white (tint at draw time).
/// </summary>
public sealed class BitmapFont
{
    private sealed class Glyph
    {
        public int X { get; set; }
        public int Y { get; set; }
        public int W { get; set; }
        public int H { get; set; }
        public float Ox { get; set; }
        public float Adv { get; set; }
    }

    private sealed class FontJson
    {
        public float Size { get; set; }
        public float Ascent { get; set; }
        public float Descent { get; set; }
        public float LineHeight { get; set; }
        public float Pad { get; set; }
        public Dictionary<string, Glyph> Glyphs { get; set; }
    }

    private readonly Dictionary<int, Glyph> _glyphs = new();
    private Glyph _fallback;

    public Texture2D Texture { get; private set; }
    public float Size { get; private set; }
    public float Ascent { get; private set; }
    public float Pad { get; private set; }
    public float LineHeight { get; private set; }

    public static BitmapFont Load(Stream json, Texture2D texture)
    {
        var data = JsonSerializer.Deserialize<FontJson>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        var font = new BitmapFont { Texture = texture, Size = data.Size, Ascent = data.Ascent, Pad = data.Pad, LineHeight = data.LineHeight };
        foreach (var (k, g) in data.Glyphs) font._glyphs[int.Parse(k)] = g;
        font._fallback = font._glyphs.GetValueOrDefault('?');
        return font;
    }

    private Glyph Get(int code) => _glyphs.TryGetValue(code, out var g) ? g : _fallback;

    /// <summary>Width of a string at a pixel size (letter spacing in em).</summary>
    public float Measure(string text, float px, float spacing = 0)
    {
        var s = px / Size;
        float w = 0;
        foreach (var rune in text.EnumerateRunes())
        {
            var g = Get(rune.Value);
            if (g == null) continue;
            w += g.Adv * s + spacing * px;
        }
        return text.Length > 0 ? w - spacing * px : 0;
    }

    /// <summary>Draws text with its top-left at <paramref name="pos"/> (cap box, like CSS).</summary>
    public void Draw(SpriteBatch sb, string text, Vector2 pos, float px, Color color, float spacing = 0)
    {
        var s = px / Size;
        var x = pos.X;
        // Atlas cells start `pad` above the ascent line; CSS text top ~ ascent - size*0.8.
        var y = pos.Y - (Pad + Ascent - Size * 0.86f) * s;
        foreach (var rune in text.EnumerateRunes())
        {
            var g = Get(rune.Value);
            if (g == null) continue;
            sb.Draw(Texture, new Vector2(x + g.Ox * s, y), new Rectangle(g.X, g.Y, g.W, g.H), color, 0, Vector2.Zero, s, SpriteEffects.None, 0);
            x += g.Adv * s + spacing * px;
        }
    }

    /// <summary>Text with a solid offset shadow (the HUD's "0 3px 0 dark" text-shadow).</summary>
    public void DrawShadowed(SpriteBatch sb, string text, Vector2 pos, float px, Color color, Color shadow, Vector2 offset, float spacing = 0)
    {
        Draw(sb, text, pos + offset, px, shadow, spacing);
        Draw(sb, text, pos, px, color, spacing);
    }

    /// <summary>Outlined text (stroke drawn as 8 offset copies).</summary>
    public void DrawOutlined(SpriteBatch sb, string text, Vector2 pos, float px, Color color, Color outline, float thickness, float spacing = 0)
    {
        for (var i = 0; i < 8; i++)
        {
            var a = i * MathF.PI / 4;
            Draw(sb, text, pos + new Vector2(MathF.Cos(a), MathF.Sin(a)) * thickness, px, outline, spacing);
        }
        Draw(sb, text, pos, px, color, spacing);
    }
}
