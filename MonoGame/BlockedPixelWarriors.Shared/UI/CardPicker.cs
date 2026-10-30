using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Gameplay;
using BlockedPixelWarriors.Input;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Input;

namespace BlockedPixelWarriors.UI;

/// <summary>
/// Upgrade card picker (UpgradeCards.js CardPicker). While it is up the world drains to ash grey
/// (<see cref="PostProcessor.Ash"/>) but the game keeps running underneath. The cards (Blender card
/// model, poker-card thin) fly in face down, flip over, float and tilt toward the pointer; click /
/// tap one or press 1 / 2. Pointing at (desktop) or tapping (touch) the painting fades the banner
/// and text away to show the whole picture. Cards are drawn at full resolution after the scene's
/// post chain, tone mapped per fragment like Three draws its separate card canvas.
/// </summary>
public sealed class CardPicker : ICardPicker, IDisposable
{
    private const float CardW = 0.63f, CardH = 0.88f;
    private const float BannerY0 = -0.175f, BannerH = 0.092f;
    private const float ArtEdge = BannerY0 + BannerH / 2 + 0.01f;
    private static readonly Vector3 CameraPos = new(0, 0, 2.45f);

    private sealed class Card
    {
        public CardDefData Def;
        public int Index;
        public float HomeX, Delay;
        public Texture2D Front, Art, Banner;
        public Vector3 Jewel, Glow;
        public float HoverT, RevealT, OnArt, Sheen, Sweep = -1, GlowOpacity, Fade = 1;
        public Matrix World;
    }

    private sealed class Picked
    {
        public int Index;
        public float T;
        public bool Fired;
    }

    private readonly GraphicsDevice _device;
    private readonly AssetStore _assets;
    private readonly PostProcessor _post;
    private readonly UiKit _ui;
    private readonly Effect _fx;
    private readonly EffectTechnique _card, _glowTech;
    private readonly EffectParameter _world, _viewProj, _baseColor, _emissive, _matParams, _flags, _cardParams, _cardParams2;
    private readonly EffectParameter _albedo, _art, _env;
    private readonly GpuMesh _mesh;
    private readonly Texture2D _back, _glowTex, _shade;
    private readonly VertexBuffer _glowVb;
    private readonly IndexBuffer _glowIb;
    private readonly List<Card> _cards = new();
    private Action<CardDefData> _onPick;
    private Picked _picked;
    private float _time, _ash, _uiAlpha;
    private int _hover = -1, _inspect = -1;
    private bool _hoverOnArt;
    private Vector2 _pointer = new(-9999, -9999);
    private bool _touchHint;
    private Matrix _view, _proj, _rootMatrix;
    private Rectangle _vp;

    public bool Active { get; private set; }
    /// <summary>True while the heading is up (toasts and notices stay out of the way).</summary>
    public bool Open => Active && _picked == null;

    public CardPicker(GraphicsDevice device, AssetStore assets, ModelLibrary models, PostProcessor post, UiKit ui, LightRig lights)
    {
        _device = device;
        _assets = assets;
        _post = post;
        _ui = ui;
        _fx = assets.Effect("Card");
        _card = _fx.Techniques["Card"];
        _glowTech = _fx.Techniques["CardGlow"];
        var p = _fx.Parameters;
        _world = p["World"];
        _viewProj = p["ViewProj"];
        _baseColor = p["BaseColor"];
        _emissive = p["EmissiveColor"];
        _matParams = p["MatParams"];
        _flags = p["Flags"];
        _cardParams = p["CardParams"];
        _cardParams2 = p["CardParams2"];
        _albedo = p["Albedo"];
        _art = p["CardArt"];
        _env = p["EnvMap"];
        // Card renderer lights (UpgradeCards.js): warm key, cool rim, ambient, RoomEnvironment at 0.9.
        p["KeyDir"].SetValue(Vector3.Normalize(new Vector3(-1.5f, 2, 3)));
        p["KeyColor"].SetValue(Palette.ToLinear(0xfff1dc) * 2.2f);
        p["RimDir"].SetValue(Vector3.Normalize(new Vector3(2, -1, 1.5f)));
        p["RimColor"].SetValue(Palette.ToLinear(0x9fc4ff) * 1.2f);
        p["Ambient"].SetValue(new Vector3(0.35f / MathF.PI));
        p["EnvIntensity"].SetValue(lights.EnvMap != null ? 0.9f : 0f);
        p["CameraPos"].SetValue(CameraPos);
        _env.SetValue(lights.EnvMap);
        _mesh = models.Mesh("card");
        _back = assets.Texture("card_back");
        _glowTex = assets.Texture("card_glow");
        // Glow plane behind each card (PlaneGeometry CARD_W * 1.9 x CARD_H * 1.6 at z = -0.04).
        float gw = CardW * 1.9f / 2, gh = CardH * 1.6f / 2;
        var white = Color.White;
        var verts = new[]
        {
            new MeshVertex { Position = new Vector3(-gw, gh, -0.04f), Normal = Vector3.UnitZ, Uv = new Vector2(0, 0), Color = white },
            new MeshVertex { Position = new Vector3(gw, gh, -0.04f), Normal = Vector3.UnitZ, Uv = new Vector2(1, 0), Color = white },
            new MeshVertex { Position = new Vector3(-gw, -gh, -0.04f), Normal = Vector3.UnitZ, Uv = new Vector2(0, 1), Color = white },
            new MeshVertex { Position = new Vector3(gw, -gh, -0.04f), Normal = Vector3.UnitZ, Uv = new Vector2(1, 1), Color = white },
        };
        _glowVb = new VertexBuffer(device, VertexFormats.Mesh, 4, BufferUsage.WriteOnly);
        _glowVb.SetData(verts);
        _glowIb = new IndexBuffer(device, IndexElementSize.SixteenBits, 6, BufferUsage.WriteOnly);
        _glowIb.SetData(new short[] { 0, 1, 2, 2, 1, 3 });
        // card-ui::before: dark bands at the top and bottom of the screen.
        _shade = new Texture2D(device, 1, 256);
        var data = new Color[256];
        for (var i = 0; i < 256; i++)
        {
            var y = i / 255f;
            var a = y < 0.24f ? MathHelper.Lerp(0.62f, 0, y / 0.24f) : y > 0.78f ? MathHelper.Lerp(0, 0.6f, (y - 0.78f) / 0.22f) : 0;
            data[i] = new Color(8 / 255f * a, 8 / 255f * a, 10 / 255f * a, a);
        }
        _shade.SetData(data);
    }

    // ---- ICardPicker --------------------------------------------------------------------------

    public void Show(IReadOnlyList<CardDefData> defs, Action<CardDefData> onPick)
    {
        if (Active || defs.Count == 0) return;
        _cards.Clear();
        _onPick = onPick;
        Active = true;
        _picked = null;
        _inspect = -1;
        _time = 0;
        _hover = -1;
        var n = defs.Count;
        for (var i = 0; i < n; i++)
        {
            var d = defs[i];
            _cards.Add(new Card
            {
                Def = d,
                Index = i,
                HomeX = (i - (n - 1) / 2f) * 0.78f,
                Delay = 0.15f + i * 0.14f,
                Front = _assets.Texture($"card_{d.Id}_front"),
                Art = _assets.Texture($"card_{d.Id}_art"),
                Banner = _assets.Texture($"card_{d.Id}_banner"),
                Jewel = d.Jewel is { Length: >= 3 } j ? new Vector3(j[0], j[1], j[2]) : Vector3.One,
                Glow = d.Glow is { Length: >= 3 } g ? new Vector3(g[0], g[1], g[2]) : Vector3.One,
            });
        }
    }

    public void Cancel()
    {
        Active = false;
        _picked = null;
        _cards.Clear();
    }

    /// <summary>Plays a card (index into the row); used by input and by automated captures.</summary>
    public void Pick(int i)
    {
        if (!Active || _picked != null || i < 0 || i >= _cards.Count) return;
        _picked = new Picked { Index = i };
    }

    // ---- Update -------------------------------------------------------------------------------

    private static float Ease(float t) => 1 - MathF.Pow(1 - MathX.Clamp01(t), 3);

    private static float EaseInOut(float t)
    {
        var x = MathX.Clamp01(t);
        return x < 0.5f ? 4 * x * x * x : 1 - MathF.Pow(-2 * x + 2, 3) / 2;
    }

    /// <summary>Called every frame from the game loop (keeps running while the cards are up).</summary>
    public void Update(float dt, GameInput input, Rectangle vp)
    {
        var target = Active && (_picked == null || _picked.T < 0.55f) ? 1 : 0;
        _ash += (target - _ash) * (1 - MathF.Exp(-(target > 0 ? 5 : 3.5f) * dt));
        if (_ash < 0.002f && target == 0) _ash = 0;
        _post.Ash = _ash;
        var uiTarget = Open ? 1 : 0;
        _uiAlpha = MathHelper.Clamp(_uiAlpha + (uiTarget - _uiAlpha) * MathX.Damp(9, dt), 0, 1);
        if (!Active) return;
        _time += dt;
        Layout(vp);
        HandleInput(input);
        _hover = _picked != null ? _hover : HitCard(out _hoverOnArt);
        var t = _time;
        foreach (var c in _cards)
        {
            var u = EaseInOut((t - c.Delay) / 0.75f);
            var hovered = _hover == c.Index && u >= 1;
            c.HoverT += ((hovered ? 1 : 0) - c.HoverT) * (1 - MathF.Exp(-10 * dt));
            // Fly in face down, flip over on the way.
            var bob = MathF.Sin(t * 1.6f + c.Index * 1.7f) * 0.012f;
            var x = MathHelper.Lerp(c.HomeX * 0.6f, c.HomeX, u);
            var y = MathHelper.Lerp(-1.5f, 0, Ease((t - c.Delay) / 0.75f)) + bob + c.HoverT * 0.03f;
            var z = MathHelper.Lerp(0.4f, 0, u) + c.HoverT * 0.1f;
            var ry = MathHelper.Lerp(MathF.PI, 0, u);
            var rx = MathHelper.Lerp(-0.6f, 0, u);
            var rz = MathHelper.Lerp(0.3f * (c.Index > 0 ? 1 : -1), (c.Index - (_cards.Count - 1) / 2f) * -0.03f, u);
            // Tilt toward the pointer while hovered.
            if (c.HoverT > 0.001f)
            {
                var ndc = PointerNdc();
                var px = MathHelper.Clamp(ndc.X * 1.8f - x * 0.9f, -1, 1);
                var py = MathHelper.Clamp(ndc.Y * 1.8f - y * 0.9f, -1, 1);
                ry += px * 0.28f * c.HoverT;
                rx += -py * 0.22f * c.HoverT;
            }
            var scaleBoost = 0f;
            var scale = 1 + c.HoverT * 0.07f;
            var fade = 1f;
            // Shine sweeping across the face: once when it lands, then on hover.
            if (u >= 1 && c.Sweep < 1.2f) c.Sweep += dt * 1.6f;
            if (hovered && c.Sweep >= 1.2f) c.Sweep = -0.9f;
            c.Sheen = 0.75f + c.HoverT * 0.5f;
            // Inspect: pointer resting on the picture (or a touch tap) fades banner + text away.
            var onArt = (hovered && _hoverOnArt) || _inspect == c.Index;
            c.OnArt = onArt ? c.OnArt + dt : 0;
            var wantReveal = _picked == null && (_inspect == c.Index || c.OnArt > 0.25f) ? 1 : 0;
            c.RevealT += (wantReveal - c.RevealT) * (1 - MathF.Exp(-(wantReveal > 0 ? 7 : 9) * dt));
            if (c.RevealT > 0.01f) scaleBoost = c.RevealT * 0.03f;
            var glow = c.HoverT * 0.55f;
            if (_picked != null)
            {
                var k = _picked.T;
                if (c.Index == _picked.Index)
                {
                    // Chosen: rises to the centre, flares, then shrinks away into the game.
                    var a = EaseInOut(k / 0.45f);
                    x = MathHelper.Lerp(x, 0, a);
                    y = MathHelper.Lerp(y, 0.05f, a);
                    z = MathHelper.Lerp(z, 0.35f, a);
                    rx *= 1 - a;
                    ry *= 1 - a;
                    rz *= 1 - a;
                    scale *= 1 + 0.18f * a;
                    glow = 0.55f + a * 0.6f;
                    if (k > 0.55f)
                    {
                        var b = EaseInOut((k - 0.55f) / 0.45f);
                        scale *= 1 - b * 0.85f;
                        y += b * 0.25f;
                        rz += b * 0.6f;
                        fade = 1 - b;
                        glow *= 1 - b;
                    }
                }
                else
                {
                    // Not chosen: drops away and fades.
                    var a = EaseInOut(k / 0.6f);
                    y -= a * 1.4f;
                    rx -= a * 0.8f;
                    rz += (c.Index > _picked.Index ? 1 : -1) * a * 0.5f;
                    fade = 1 - a;
                    glow = 0;
                }
            }
            c.Fade = fade;
            c.GlowOpacity = glow;
            c.World = Matrix.CreateScale(scale + scaleBoost) * MathX.RotationXYZ(rx, ry, rz) * Matrix.CreateTranslation(x, y, z) * _rootMatrix;
        }
        if (_picked != null)
        {
            var p = _picked;
            p.T += dt;
            if (!p.Fired && p.T > 0.5f)
            {
                p.Fired = true;
                _onPick?.Invoke(_cards[p.Index].Def);
            }
            if (p.T > 1.05f)
            {
                Active = false;
                _cards.Clear();
            }
        }
    }

    /// <summary>Camera + row scale (fits the row of cards on narrow screens).</summary>
    private void Layout(Rectangle vp)
    {
        _vp = vp;
        var aspect = vp.Width / (float)Math.Max(1, vp.Height);
        _view = Matrix.CreateLookAt(CameraPos, Vector3.Zero, Vector3.Up);
        _proj = Matrix.CreatePerspectiveFieldOfView(MathHelper.ToRadians(30), aspect, 0.1f, 20);
        var visibleW = 2 * CameraPos.Z * MathF.Tan(MathHelper.ToRadians(15)) * aspect;
        var need = Math.Max(1, _cards.Count) * 0.78f + 0.1f;
        _rootMatrix = Matrix.CreateScale(MathF.Min(1, visibleW / need)) * Matrix.CreateTranslation(0, -0.04f, 0);
    }

    private Vector2 PointerNdc() => new(_pointer.X / Math.Max(1, _vp.Width) * 2 - 1, -(_pointer.Y / Math.Max(1, _vp.Height) * 2 - 1));

    private void HandleInput(GameInput input)
    {
        if (input.PointerMoved || input.Taps.Count > 0) _pointer = input.Pointer - new Vector2(_vp.X, _vp.Y);
        _touchHint = input.TouchMode;
        if (_picked != null) return;
        foreach (var tap in input.Taps)
        {
            _pointer = tap.Position - new Vector2(_vp.X, _vp.Y);
            var i = HitCard(out var onArt);
            if (i < 0 || _time < _cards[i].Delay + 0.6f) continue;
            // Touch: tapping the picture shows the whole painting (tap again or the banner to choose).
            if (tap.Touch && onArt && _inspect != i)
            {
                _inspect = i;
                continue;
            }
            Pick(i);
            return;
        }
        var key = input.Pressed(Keys.D1) || input.Pressed(Keys.NumPad1) ? 0 : input.Pressed(Keys.D2) || input.Pressed(Keys.NumPad2) ? 1 : -1;
        if (key >= 0 && key < _cards.Count && _time >= _cards[key].Delay + 0.6f) Pick(key);
    }

    /// <summary>Card under the pointer (nearest), and whether the pointer is on its painting.</summary>
    private int HitCard(out bool onArt)
    {
        onArt = false;
        if (!Active || _picked != null) return -1;
        var ndc = PointerNdc();
        var inv = Matrix.Invert(_view * _proj);
        var near = Unproject(new Vector3(ndc, 0), inv);
        var far = Unproject(new Vector3(ndc, 1), inv);
        var best = -1;
        var bestD = float.MaxValue;
        foreach (var c in _cards)
        {
            if (c.World == default) continue;
            var toLocal = Matrix.Invert(c.World);
            var o = Vector3.Transform(near, toLocal);
            var d = Vector3.Transform(far, toLocal) - o;
            if (MathF.Abs(d.Z) < 1e-6f) continue;
            var t = -o.Z / d.Z;
            if (t < 0) continue;
            var p = o + d * t;
            var halfW = CardW / 2 + (MathF.Abs(p.Y - BannerY0) < BannerH / 2 ? 0.035f : 0);
            if (MathF.Abs(p.X) > halfW || MathF.Abs(p.Y) > CardH / 2) continue;
            var dist = Vector3.Distance(near, Vector3.Transform(p, c.World));
            if (dist < bestD)
            {
                bestD = dist;
                best = c.Index;
                // Above the banner = on the painting.
                onArt = p.Y > ArtEdge;
            }
        }
        return best;
    }

    private static Vector3 Unproject(Vector3 ndc, in Matrix inverseViewProj)
    {
        var p = Vector4.Transform(new Vector4(ndc, 1), inverseViewProj);
        return new Vector3(p.X, p.Y, p.Z) / p.W;
    }

    // ---- Draw ---------------------------------------------------------------------------------

    /// <summary>The cards, straight onto the current target (full resolution, own depth).</summary>
    public void Draw(Rectangle vp)
    {
        if (!Active || _cards.Count == 0) return;
        Layout(vp);
        _device.Clear(ClearOptions.DepthBuffer, Color.Transparent, 1, 0);
        _viewProj.SetValue(_view * _proj);
        _device.SamplerStates[0] = SamplerState.AnisotropicClamp;
        _device.SamplerStates[1] = SamplerState.AnisotropicClamp;
        _device.SamplerStates[2] = EnvSampler;
        foreach (var c in _cards)
        {
            if (c.World == default) continue;
            // Soft coloured glow behind the card (hover / pick), additive.
            if (c.GlowOpacity > 0.002f)
            {
                _device.BlendState = RenderStates.AdditiveBlend;
                _device.DepthStencilState = DepthStencilState.DepthRead;
                _device.RasterizerState = RasterizerState.CullNone;
                _world.SetValue(c.World);
                _baseColor.SetValue(new Vector4(c.Glow, c.GlowOpacity));
                _albedo.SetValue(_glowTex);
                _fx.CurrentTechnique = _glowTech;
                _fx.CurrentTechnique.Passes[0].Apply();
                _device.SetVertexBuffer(_glowVb);
                _device.Indices = _glowIb;
                _device.DrawIndexedPrimitives(PrimitiveType.TriangleList, 0, 0, 2);
            }
            // Card parts back to front (the banner sits on the face).
            _device.BlendState = RenderStates.NormalBlend;
            _device.DepthStencilState = DepthStencilState.Default;
            foreach (var order in DrawOrder)
            foreach (var part in _mesh.Parts)
            {
                if (part.Material.Name != order) continue;
                DrawPart(c, part);
            }
            foreach (var part in _mesh.Parts)
                if (Array.IndexOf(DrawOrder, part.Material.Name) < 0) DrawPart(c, part);
        }
        _device.BlendState = BlendState.Opaque;
        _device.DepthStencilState = DepthStencilState.Default;
        _device.RasterizerState = RasterizerState.CullCounterClockwise;
    }

    private static readonly SamplerState EnvSampler = new() { AddressU = TextureAddressMode.Wrap, AddressV = TextureAddressMode.Clamp, Filter = TextureFilter.Linear };

    private static readonly string[] DrawOrder = { "CardBack", "CardEdge", "CardGold", "CardFront", "CardJewel", "CardBanner", "CardTail" };

    private void DrawPart(Card c, MeshPart part)
    {
        var name = part.Material.Name;
        Texture2D map = null;
        var color = Vector3.One;
        var emissive = Vector3.Zero;
        float rough = 0.7f, metal = 0, clearcoat = 0, ccRough = 0, sheen = 0, reveal = 0, flat = 0;
        var doubleSided = false;
        var opacity = c.Fade;
        switch (name)
        {
            case "CardFront":
                map = c.Front;
                rough = 0.42f;
                clearcoat = 0.7f;
                ccRough = 0.18f;
                sheen = c.Sheen;
                reveal = c.RevealT;
                break;
            case "CardBack":
                map = _back;
                rough = 0.5f;
                clearcoat = 0.5f;
                break;
            case "CardBanner":
                map = c.Banner;
                rough = 0.5f;
                doubleSided = true;
                opacity *= 1 - c.RevealT;
                break;
            case "CardTail":
                color = Palette.ToLinear(0x5e0b10);
                rough = 0.6f;
                doubleSided = true;
                opacity *= 1 - c.RevealT;
                break;
            case "CardGold":
                color = Palette.ToLinear(0xe6bb58);
                rough = 0.22f;
                metal = 1;
                break;
            case "CardJewel":
                color = c.Jewel;
                emissive = c.Jewel * 0.6f;
                rough = 0.05f;
                clearcoat = 1;
                flat = 1;
                break;
            default:
                color = Palette.ToLinear(0xe6d9b8); // paper edge
                break;
        }
        if (opacity <= 0.002f) return;
        _world.SetValue(c.World);
        _baseColor.SetValue(new Vector4(color, opacity));
        _emissive.SetValue(emissive);
        _matParams.SetValue(new Vector4(rough, metal, 1, 0));
        _flags.SetValue(new Vector4(map != null ? 1 : 0, doubleSided ? 1 : 0, 0, 0));
        _cardParams.SetValue(new Vector4(reveal, sheen, c.Sweep, clearcoat));
        _cardParams2.SetValue(new Vector4(ccRough, flat, 0, 0));
        _albedo.SetValue(map ?? _assets.White);
        _art.SetValue(c.Art ?? map ?? _assets.White);
        _device.RasterizerState = doubleSided ? RasterizerState.CullNone : RenderStates.CullBack;
        _fx.CurrentTechnique = _card;
        _fx.CurrentTechnique.Passes[0].Apply();
        _device.SetVertexBuffer(_mesh.Vertices);
        _device.Indices = _mesh.Indices;
        _device.DrawIndexedPrimitives(PrimitiveType.TriangleList, part.BaseVertex, part.StartIndex, part.PrimitiveCount);
    }

    /// <summary>Heading, sub title and hint (card-ui), drawn with the HUD batch already begun.</summary>
    public void DrawUi(Rectangle vp)
    {
        if (_uiAlpha < 0.01f) return;
        var k = _ui.Scale;
        var a = _uiAlpha;
        _ui.Batch.Draw(_shade, new Rectangle(vp.X, vp.Y, vp.Width, vp.Height), Color.White * a);
        var cssW = vp.Width / k;
        var headPx = Math.Clamp(cssW * 0.034f, 20, 40) * k;
        var top = vp.Y + vp.Height * 0.055f;
        var heading = "CHOOSE AN UPGRADE";
        var cx = vp.Center.X;
        var hw = _ui.Serif.Measure(heading, headPx, 0.32f);
        var pos = new Vector2(cx - hw / 2, top);
        // text-shadow: warm glow, a dark drop and the gold letters.
        for (var i = 0; i < 12; i++)
        {
            var ang = i * MathF.PI / 6;
            _ui.Serif.Draw(_ui.Batch, heading, pos + new Vector2(MathF.Cos(ang), MathF.Sin(ang)) * 7 * k, headPx, new Color(255, 200, 90) * (0.05f * a), 0.32f);
        }
        _ui.Serif.Draw(_ui.Batch, heading, pos + new Vector2(0, 2 * k), headPx, new Color(0x1a, 0x10, 0x04) * a, 0.32f);
        _ui.Serif.Draw(_ui.Batch, heading, pos, headPx, new Color(0xf6, 0xdc, 0x91) * a, 0.32f);
        var subPx = Math.Clamp(cssW * 0.013f, 11, 15) * k;
        var subY = top + Math.Clamp(cssW * 0.046f, 30, 54) * k;
        _ui.Serif.DrawShadowed(_ui.Batch, "the train is down", new Vector2(cx - _ui.Serif.Measure("the train is down", subPx, 0.2f) / 2, subY), subPx, new Color(245, 238, 222) * 0.9f * a, Color.Black * 0.8f * a, new Vector2(0, k), 0.2f);
        // Hint line with boxed keys.
        var hintPx = Math.Clamp(cssW * 0.01f, 9, 12) * k;
        var y = subY + subPx * 1.3f + 6 * k;
        var keys = _cards.Count > 1 ? new[] { ("CLICK A CARD OR PRESS ", false), ("1", true), (" / ", false), ("2", true), (" · POINT AT THE PICTURE TO SEE IT WHOLE", false) }
            : new[] { ("CLICK A CARD OR PRESS ", false), ("1", true), (" · POINT AT THE PICTURE TO SEE IT WHOLE", false) };
        var parts = _touchHint ? new[] { ("TAP THE PICTURE TO SEE IT WHOLE · TAP THE BANNER TO CHOOSE", false) } : keys;
        var total = 0f;
        foreach (var (t, boxed) in parts) total += _ui.Ui.Measure(t, hintPx, 0.22f) + (boxed ? 18 * k : 0);
        var x = cx - total / 2;
        foreach (var (t, boxed) in parts)
        {
            var w = _ui.Ui.Measure(t, hintPx, 0.22f);
            if (boxed)
            {
                var r = new RectangleF(x + 4 * k, y - 2 * k, w + 10 * k, hintPx + 4 * k);
                _ui.Outline(r, 3 * k, new Color(243, 215, 138) * 0.7f * a);
                _ui.Ui.DrawShadowed(_ui.Batch, t, new Vector2(x + 9 * k, y), hintPx, new Color(0xf3, 0xd7, 0x8a) * a, Color.Black * 0.8f * a, new Vector2(0, k), 0.22f);
                x += w + 18 * k;
            }
            else
            {
                _ui.Ui.DrawShadowed(_ui.Batch, t, new Vector2(x, y), hintPx, new Color(240, 235, 225) * 0.85f * a, Color.Black * 0.8f * a, new Vector2(0, k), 0.22f);
                x += w;
            }
        }
    }

    public void Dispose()
    {
        _glowVb.Dispose();
        _glowIb.Dispose();
        _shade.Dispose();
    }
}
