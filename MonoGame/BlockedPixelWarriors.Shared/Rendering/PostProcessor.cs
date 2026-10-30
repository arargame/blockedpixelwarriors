using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Core;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Rendering;

/// <summary>
/// The web post chain (RenderPipeline.js): HDR scene target (MSAA) -> foreground blur composite
/// -> UnrealBloom (5 mips) -> grade (+ash) -> barrel lens + fringe -> ACES -> sRGB, the last
/// four fused into one full-screen pass straight into the back buffer.
/// </summary>
public sealed class PostProcessor : IDisposable
{
    private readonly GraphicsDevice _device;
    private readonly Effect _fx;
    private readonly RenderQuality _quality;
    private readonly VertexBuffer _triangle;
    private readonly EffectParameter _texel, _direction, _kernel, _bloomParams, _bloomFactors, _bloomFactor4;
    private readonly EffectParameter _exposure, _saturation, _contrast, _vignette, _sunPos, _sunColor, _sunStrength, _aspect;
    private readonly EffectParameter _haze, _hazeStrength, _tint, _ash, _lensK, _fringe, _toneExposure, _opacity;
    private readonly EffectParameter _source;
    private readonly EffectParameter[] _bloomTex = new EffectParameter[5];
    private readonly SurfaceFormat _hdrFormat;
    private RenderTarget2D _scene, _fgA, _fgB, _bright, _combined, _ldr;
    private readonly RenderTarget2D[] _mipH = new RenderTarget2D[5], _mipV = new RenderTarget2D[5];
    private static readonly int[] KernelSizes = { 3, 5, 7, 9, 11 };
    private static readonly float[] BloomFactors = { 1.0f, 0.8f, 0.6f, 0.4f, 0.2f };
    private readonly PostData _post;

    public int Width { get; private set; }
    public int Height { get; private set; }
    public RenderTarget2D Scene => _scene;
    public float Ash { get; set; }
    public float LensK { get; set; }
    public float Fringe { get; set; } = 0.0025f;
    public bool HdrSupported => _hdrFormat == SurfaceFormat.HalfVector4;

    public PostProcessor(GraphicsDevice device, Effect fx, PostData post, RenderQuality quality)
    {
        _device = device;
        _fx = fx;
        _post = post;
        _quality = quality;
        _hdrFormat = ProbeHdr(device);
        _triangle = new VertexBuffer(device, VertexFormats.Position, 3, BufferUsage.WriteOnly);
        _triangle.SetData(new[] { new Vector3(-1, -1, 0), new Vector3(3, -1, 0), new Vector3(-1, 3, 0) });
        var p = fx.Parameters;
        _texel = p["Texel"];
        _direction = p["Direction"];
        _kernel = p["KernelRadius"];
        _bloomParams = p["BloomParams"];
        _bloomFactors = p["BloomFactors"];
        _bloomFactor4 = p["BloomFactor4"];
        _exposure = p["Exposure"];
        _saturation = p["Saturation"];
        _contrast = p["Contrast"];
        _vignette = p["Vignette"];
        _sunPos = p["SunPos"];
        _sunColor = p["SunColor"];
        _sunStrength = p["SunStrength"];
        _aspect = p["Aspect"];
        _haze = p["Haze"];
        _hazeStrength = p["HazeStrength"];
        _tint = p["Tint"];
        _ash = p["Ash"];
        _lensK = p["LensK"];
        _fringe = p["Fringe"];
        _toneExposure = p["ToneExposure"];
        _opacity = p["Opacity"];
        _source = p["Source"];
        for (var i = 0; i < 5; i++) _bloomTex[i] = p[$"Bloom{i}"];
    }

    /// <summary>Half-float colour targets where the GPU can render them, else 8-bit.</summary>
    private static SurfaceFormat ProbeHdr(GraphicsDevice device)
    {
        try
        {
            using var rt = new RenderTarget2D(device, 4, 4, false, SurfaceFormat.HalfVector4, DepthFormat.None);
            device.SetRenderTarget(rt);
            device.Clear(Color.Black);
            device.SetRenderTarget(null);
            return SurfaceFormat.HalfVector4;
        }
        catch (Exception)
        {
            device.SetRenderTarget(null);
            return SurfaceFormat.Color;
        }
    }

    public void Resize(int width, int height)
    {
        width = Math.Max(1, width);
        height = Math.Max(1, height);
        if (width == Width && height == Height && _scene != null) return;
        Width = width;
        Height = height;
        DisposeTargets();
        _scene = new RenderTarget2D(_device, width, height, false, _hdrFormat, DepthFormat.Depth24, 0, RenderTargetUsage.PreserveContents);
        if (_quality.ForegroundBlur)
        {
            int fw = Math.Max(1, width / 2), fh = Math.Max(1, height / 2);
            _fgA = new RenderTarget2D(_device, fw, fh, false, _hdrFormat, DepthFormat.Depth24);
            _fgB = new RenderTarget2D(_device, fw, fh, false, _hdrFormat, DepthFormat.None);
        }
        int bw = Math.Max(1, (int)MathF.Round(width / 2f)), bh = Math.Max(1, (int)MathF.Round(height / 2f));
        _bright = new RenderTarget2D(_device, bw, bh, false, _hdrFormat, DepthFormat.None);
        _combined = new RenderTarget2D(_device, bw, bh, false, _hdrFormat, DepthFormat.None);
        for (var i = 0; i < 5; i++)
        {
            _mipH[i] = new RenderTarget2D(_device, bw, bh, false, _hdrFormat, DepthFormat.None);
            _mipV[i] = new RenderTarget2D(_device, bw, bh, false, _hdrFormat, DepthFormat.None);
            bw = Math.Max(1, (int)MathF.Round(bw / 2f));
            bh = Math.Max(1, (int)MathF.Round(bh / 2f));
        }
    }

    // ---- Foreground layer (ForegroundBlurPass) -------------------------------------------------

    public bool HasForeground => _fgA != null;

    /// <summary>Binds the half-resolution foreground target (transparent black).</summary>
    public void BeginForeground()
    {
        _device.SetRenderTarget(_fgA);
        _device.Clear(ClearOptions.Target | ClearOptions.DepthBuffer, Vector4.Zero, 1, 0);
    }

    /// <summary>Two separable blur iterations (radius 0.75, growing per iteration).</summary>
    public void BlurForeground()
    {
        _texel.SetValue(new Vector2(1f / _fgA.Width, 1f / _fgA.Height));
        for (var i = 0; i < 2; i++)
        {
            var spread = 0.75f * (i + 1);
            Pass("BlurRgba", _fgA, _fgB, new Vector2(spread, 0));
            Pass("BlurRgba", _fgB, _fgA, new Vector2(0, spread));
        }
    }

    /// <summary>Composites the blurred foreground over the bound scene target.</summary>
    public void CompositeForeground()
    {
        _source.SetValue(_fgA);
        _opacity.SetValue(1f);
        DrawFullscreen("Copy", RenderStates.PremultipliedOver);
    }

    public void BeginScene(Color clear)
    {
        _device.SetRenderTarget(_scene);
        _device.Clear(ClearOptions.Target | ClearOptions.DepthBuffer, clear, 1, 0);
    }

    // ---- Bloom + final composite --------------------------------------------------------------

    /// <summary>Runs bloom on the finished scene and writes the graded, tone-mapped frame.</summary>
    public void Present(RenderTarget2D output, Rectangle viewport)
    {
        var bloom = _post.Bloom;
        var hasBloom = _quality.Bloom && bloom != null;
        if (hasBloom)
        {
            _bloomParams.SetValue(new Vector4(bloom.Threshold, 0.01f, bloom.Strength, 0));
            Pass("Bright", _scene, _bright, Vector2.Zero, setTexel: false);
            Texture2D input = _bright;
            for (var i = 0; i < 5; i++)
            {
                _kernel.SetValue((float)KernelSizes[i]);
                _texel.SetValue(new Vector2(1f / _mipH[i].Width, 1f / _mipH[i].Height));
                Pass("BloomBlur", input, _mipH[i], new Vector2(1, 0), setTexel: false);
                Pass("BloomBlur", _mipH[i], _mipV[i], new Vector2(0, 1), setTexel: false);
                input = _mipV[i];
            }
            float F(int i) => MathHelper.Lerp(BloomFactors[i], 1.2f - BloomFactors[i], bloom.Radius);
            _bloomFactors.SetValue(new Vector4(F(0), F(1), F(2), F(3)));
            _bloomFactor4.SetValue(F(4));
            for (var i = 0; i < 5; i++) _bloomTex[i].SetValue(_mipV[i]);
            _device.SetRenderTarget(_combined);
            DrawFullscreen("BloomCombine", BlendState.Opaque, linear: true);
            DebugDump();
        }

        // FXAA: composite into an LDR target first, then anti-alias into the output.
        var final = output;
        var finalViewport = viewport;
        if (_quality.Fxaa)
        {
            if (_ldr == null || _ldr.Width != viewport.Width || _ldr.Height != viewport.Height)
            {
                _ldr?.Dispose();
                _ldr = new RenderTarget2D(_device, viewport.Width, viewport.Height, false, SurfaceFormat.Color, DepthFormat.None);
            }
            output = _ldr;
            viewport = new Rectangle(0, 0, _ldr.Width, _ldr.Height);
        }
        _device.SetRenderTarget(output);
        _device.Viewport = new Viewport(viewport);
        _source.SetValue(_scene);
        _bloomTex[0].SetValue(hasBloom ? _combined : null);
        if (!hasBloom)
        {
            // No bloom: composite with a black bloom texture.
            _device.SetRenderTarget(_combined);
            _device.Clear(Color.Black);
            _device.SetRenderTarget(output);
            _device.Viewport = new Viewport(viewport);
            _bloomTex[0].SetValue(_combined);
        }
        var aspect = viewport.Width / (float)Math.Max(1, viewport.Height);
        _exposure.SetValue(_post.Exposure);
        _saturation.SetValue(_post.Saturation);
        _contrast.SetValue(_post.Contrast);
        _vignette.SetValue(_post.Vignette);
        _sunPos.SetValue(new Vector2(_post.SunPos[0], _post.SunPos[1]));
        _sunColor.SetValue(MathX.V3(_post.SunColor));
        _sunStrength.SetValue(_post.SunStrength);
        _aspect.SetValue(aspect);
        _haze.SetValue(MathX.V3(_post.Haze));
        _hazeStrength.SetValue(_post.HazeStrength);
        _tint.SetValue(MathX.V3(_post.Tint));
        _ash.SetValue(Ash);
        _lensK.SetValue(LensK);
        _fringe.SetValue(Fringe);
        _toneExposure.SetValue(_post.ToneMappingExposure <= 0 ? 1 : _post.ToneMappingExposure);
        DrawFullscreen("Composite", BlendState.Opaque, linear: true);
        if (_quality.Fxaa)
        {
            _device.SetRenderTarget(final);
            _device.Viewport = new Viewport(finalViewport);
            _source.SetValue(_ldr);
            _texel.SetValue(new Vector2(1f / _ldr.Width, 1f / _ldr.Height));
            DrawFullscreen("Fxaa", BlendState.Opaque, linear: true);
        }
    }

    private static readonly string DumpDir = Environment.GetEnvironmentVariable("BPW_DUMP");
    private int _dumpFrame;

    /// <summary>Debug: BPW_DUMP=dir writes the bloom chain as PNGs (tone-clamped) once.</summary>
    private void DebugDump()
    {
        if (string.IsNullOrEmpty(DumpDir) || ++_dumpFrame != 3) return;
        _device.SetRenderTarget(null);
        void Save(string name, RenderTarget2D rt)
        {
            if (rt == null || rt.Format != SurfaceFormat.HalfVector4) return;
            var data = new Microsoft.Xna.Framework.Graphics.PackedVector.HalfVector4[rt.Width * rt.Height];
            rt.GetData(data);
            var px = new Color[data.Length];
            float max = 0;
            for (var i = 0; i < data.Length; i++)
            {
                var v = data[i].ToVector4();
                max = MathF.Max(max, MathF.Max(v.X, MathF.Max(v.Y, v.Z)));
                px[i] = new Color(MathF.Min(1, v.X), MathF.Min(1, v.Y), MathF.Min(1, v.Z));
            }
            using var tex = new Texture2D(_device, rt.Width, rt.Height);
            tex.SetData(px);
            using var fs = File.Create(Path.Combine(DumpDir, name + ".png"));
            tex.SaveAsPng(fs, rt.Width, rt.Height);
            Console.WriteLine($"[dump] {name} {rt.Width}x{rt.Height} max={max:0.00}");
        }
        Save("scene", _scene);
        Save("bright", _bright);
        for (var i = 0; i < 5; i++) Save($"mipV{i}", _mipV[i]);
        Save("combined", _combined);
    }

    private void Pass(string technique, Texture2D source, RenderTarget2D target, Vector2 direction, bool setTexel = true)
    {
        _device.SetRenderTarget(target);
        _source.SetValue(source);
        _direction.SetValue(direction);
        if (setTexel) _texel.SetValue(new Vector2(1f / source.Width, 1f / source.Height));
        DrawFullscreen(technique, BlendState.Opaque, linear: true);
    }

    private void DrawFullscreen(string technique, BlendState blend, bool linear = true)
    {
        _device.BlendState = blend;
        _device.DepthStencilState = DepthStencilState.None;
        _device.RasterizerState = RasterizerState.CullNone;
        for (var i = 0; i < 6; i++) _device.SamplerStates[i] = linear ? SamplerState.LinearClamp : SamplerState.PointClamp;
        _device.SetVertexBuffer(_triangle);
        _fx.CurrentTechnique = _fx.Techniques[technique];
        _fx.CurrentTechnique.Passes[0].Apply();
        _device.DrawPrimitives(PrimitiveType.TriangleList, 0, 1);
    }

    private void DisposeTargets()
    {
        _scene?.Dispose();
        _fgA?.Dispose();
        _fgB?.Dispose();
        _bright?.Dispose();
        _combined?.Dispose();
        _ldr?.Dispose();
        _ldr = null;
        for (var i = 0; i < 5; i++)
        {
            _mipH[i]?.Dispose();
            _mipV[i]?.Dispose();
        }
    }

    public void Dispose()
    {
        DisposeTargets();
        _triangle.Dispose();
    }
}
