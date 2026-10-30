using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Assets;

/// <summary>
/// Loads and caches runtime assets from the title container (Content/...). Android ships the
/// half-size textures and mobile shader variants under the same paths (Content.Mobile is
/// packed as Content/ there), so the code never needs to know which set it got.
/// </summary>
public sealed class AssetStore : IDisposable
{
    private readonly GraphicsDevice _device;
    private readonly Dictionary<string, Texture2D> _textures = new();
    private readonly Dictionary<string, Effect> _effects = new();
    private readonly Dictionary<string, MeshFile> _meshes = new();
    private readonly Dictionary<string, BitmapFont> _fonts = new();
    private Texture2D _white;

    public AssetStore(GraphicsDevice device) => _device = device;

    public static Stream Open(string path) => TitleContainer.OpenStream(Path.Combine("Content", path).Replace('\\', '/'));

    public Texture2D White
    {
        get
        {
            if (_white == null)
            {
                _white = new Texture2D(_device, 1, 1);
                _white.SetData(new[] { Color.White });
            }
            return _white;
        }
    }

    private static readonly string[] TextureExtensions = { ".png", ".jpg" };

    /// <summary>Texture by export name (Content/Textures/name.png or .jpg), with mipmaps.</summary>
    public Texture2D Texture(string name)
    {
        if (string.IsNullOrEmpty(name)) return null;
        if (_textures.TryGetValue(name, out var t)) return t;
        t = null;
        // Paintings (upgrade cards) ship as JPEG, everything else as PNG.
        foreach (var ext in TextureExtensions)
        {
            Stream stream;
            try
            {
                stream = Open($"Textures/{name}{ext}");
            }
            catch (Exception)
            {
                // Missing in this format (Android's asset manager throws its own exception types).
                continue;
            }
            using (stream) t = LoadWithMipmaps(stream);
            break;
        }
        _textures[name] = t;
        return t;
    }

    /// <summary>
    /// Texture2D.FromStream gives a single level; build the mip chain on the CPU so distant
    /// surfaces don't shimmer (box filter, premultiplication left as authored).
    /// </summary>
    private Texture2D LoadWithMipmaps(Stream stream, bool premultiply = false)
    {
        using var source = Texture2D.FromStream(_device, stream);
        int w = source.Width, h = source.Height;
        var data = new Color[w * h];
        source.GetData(data);
        if (premultiply)
        {
            for (var i = 0; i < data.Length; i++)
            {
                var c = data[i];
                data[i] = new Color(c.R * c.A / 255, c.G * c.A / 255, c.B * c.A / 255, c.A);
            }
        }
        var tex = new Texture2D(_device, w, h, true, SurfaceFormat.Color);
        tex.SetData(0, null, data, 0, data.Length);
        var level = 1;
        while (w > 1 || h > 1)
        {
            int nw = Math.Max(1, w / 2), nh = Math.Max(1, h / 2);
            var next = new Color[nw * nh];
            for (var y = 0; y < nh; y++)
            {
                for (var x = 0; x < nw; x++)
                {
                    int x0 = Math.Min(w - 1, x * 2), x1 = Math.Min(w - 1, x * 2 + 1);
                    int y0 = Math.Min(h - 1, y * 2), y1 = Math.Min(h - 1, y * 2 + 1);
                    Color a = data[y0 * w + x0], b = data[y0 * w + x1], c = data[y1 * w + x0], d = data[y1 * w + x1];
                    next[y * nw + x] = new Color(
                        (a.R + b.R + c.R + d.R + 2) / 4,
                        (a.G + b.G + c.G + d.G + 2) / 4,
                        (a.B + b.B + c.B + d.B + 2) / 4,
                        (a.A + b.A + c.A + d.A + 2) / 4);
                }
            }
            tex.SetData(level++, null, next, 0, next.Length);
            data = next;
            w = nw;
            h = nh;
        }
        return tex;
    }

    /// <summary>UI image (premultiplied alpha for SpriteBatch), e.g. the voxel logo.</summary>
    public Texture2D UiTexture(string name)
    {
        var key = "ui:" + name;
        if (_textures.TryGetValue(key, out var t)) return t;
        using (var stream = Open($"Textures/{name}.png")) t = LoadWithMipmaps(stream, premultiply: true);
        _textures[key] = t;
        return t;
    }

    /// <summary>Pre-packed GLSL effect (Content/Effects/name.mgfx).</summary>
    public Effect Effect(string name)
    {
        if (_effects.TryGetValue(name, out var e)) return e;
        using var stream = Open($"Effects/{name}.mgfx");
        using var ms = new MemoryStream();
        stream.CopyTo(ms);
        e = new Effect(_device, ms.ToArray());
        _effects[name] = e;
        return e;
    }

    public MeshFile Mesh(string name)
    {
        if (_meshes.TryGetValue(name, out var m)) return m;
        using var stream = Open($"Models/{name}.bpm");
        using var buffered = new BufferedStream(stream, 1 << 16);
        using var reader = new BinaryReader(buffered);
        m = MeshFile.Read(reader);
        _meshes[name] = m;
        return m;
    }

    public InstanceFile Instances(string name)
    {
        using var stream = Open($"Models/{name}.bpi");
        using var buffered = new BufferedStream(stream, 1 << 16);
        using var reader = new BinaryReader(buffered);
        return InstanceFile.Read(reader);
    }

    public BitmapFont Font(string name)
    {
        if (_fonts.TryGetValue(name, out var f)) return f;
        Texture2D tex;
        using (var s = Open($"Fonts/{name}.png")) tex = LoadWithMipmaps(s, premultiply: true);
        using (var s = Open($"Fonts/{name}.json")) f = BitmapFont.Load(s, tex);
        _fonts[name] = f;
        return f;
    }

    /// <summary>
    /// Data/environment.bin: RoomEnvironment levels as one half-float texture (levels stacked
    /// vertically). Null when the GPU can't sample half floats.
    /// </summary>
    public Texture2D Environment()
    {
        try
        {
            using var s = Open("Data/environment.bin");
            using var r = new BinaryReader(s);
            var magic = System.Text.Encoding.ASCII.GetString(r.ReadBytes(4));
            if (magic != "BPE1") return null;
            int w = r.ReadInt32(), h = r.ReadInt32(), levels = r.ReadInt32();
            for (var i = 0; i < levels; i++) r.ReadSingle();
            var bytes = r.ReadBytes(w * h * levels * 8);
            var data = new Microsoft.Xna.Framework.Graphics.PackedVector.HalfVector4[w * h * levels];
            System.Runtime.InteropServices.MemoryMarshal.Cast<byte, Microsoft.Xna.Framework.Graphics.PackedVector.HalfVector4>(bytes).CopyTo(data);
            var tex = new Texture2D(_device, w, h * levels, false, SurfaceFormat.HalfVector4);
            tex.SetData(data);
            _textures["env:room"] = tex;
            return tex;
        }
        catch (Exception e) when (e is NotSupportedException or InvalidOperationException or FileNotFoundException)
        {
            return null;
        }
    }

    public SceneData Scene()
    {
        using var s = Open("Data/scene.json");
        return SceneData.Load(s);
    }

    public void Dispose()
    {
        foreach (var t in _textures.Values) t?.Dispose();
        foreach (var e in _effects.Values) e.Dispose();
        foreach (var f in _fonts.Values) f.Texture.Dispose();
        _white?.Dispose();
    }
}
