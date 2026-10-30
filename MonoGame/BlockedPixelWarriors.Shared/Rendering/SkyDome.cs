using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Core;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Rendering;

/// <summary>Gradient sky dome with the warm sun halo (Sky.js), drawn first at the far plane.</summary>
public sealed class SkyDome : IDisposable
{
    private readonly Effect _fx;
    private readonly VertexBuffer _vb;
    private readonly IndexBuffer _ib;
    private readonly int _primitives;
    private readonly EffectParameter _wvp;

    public SkyDome(GraphicsDevice device, Effect fx, SkyData sky)
    {
        _fx = fx;
        // THREE.SphereGeometry(900, 48, 24)
        const int ws = 48, hs = 24;
        const float radius = 900;
        var verts = new List<Vector3>();
        for (var iy = 0; iy <= hs; iy++)
        {
            var v = iy / (float)hs;
            for (var ix = 0; ix <= ws; ix++)
            {
                var u = ix / (float)ws;
                verts.Add(new Vector3(
                    -radius * MathF.Cos(u * MathF.PI * 2) * MathF.Sin(v * MathF.PI),
                    radius * MathF.Cos(v * MathF.PI),
                    radius * MathF.Sin(u * MathF.PI * 2) * MathF.Sin(v * MathF.PI)));
            }
        }
        var idx = new List<ushort>();
        for (var iy = 0; iy < hs; iy++)
        {
            for (var ix = 0; ix < ws; ix++)
            {
                var a = (ushort)(iy * (ws + 1) + ix + 1);
                var b = (ushort)(iy * (ws + 1) + ix);
                var c = (ushort)((iy + 1) * (ws + 1) + ix);
                var d = (ushort)((iy + 1) * (ws + 1) + ix + 1);
                idx.AddRange(new[] { a, b, d, b, c, d });
            }
        }
        _vb = new VertexBuffer(device, VertexFormats.Position, verts.Count, BufferUsage.WriteOnly);
        _vb.SetData(verts.ToArray());
        _ib = new IndexBuffer(device, IndexElementSize.SixteenBits, idx.Count, BufferUsage.WriteOnly);
        _ib.SetData(idx.ToArray());
        _primitives = idx.Count / 3;
        var p = fx.Parameters;
        _wvp = p["WorldViewProj"];
        p["Top"].SetValue(MathX.V3(sky.Top));
        p["Mid"].SetValue(MathX.V3(sky.Mid));
        p["Horizon"].SetValue(MathX.V3(sky.Horizon));
        p["Bottom"].SetValue(MathX.V3(sky.Bottom));
        p["SunDirection"].SetValue(MathX.V3(sky.SunDir));
        p["SunTint"].SetValue(MathX.V3(sky.SunColor));
        p["HorizonOffset"].SetValue(sky.HorizonOffset);
    }

    /// <param name="backdrop">tilted backdrop transform (the dome is its child)</param>
    public void Draw(GraphicsDevice device, Camera3D camera, in Matrix backdrop)
    {
        // Sky.update(): dome positioned at the camera (in the backdrop's local space).
        _wvp.SetValue(Matrix.CreateTranslation(camera.Position) * backdrop * camera.ViewProjection);
        device.BlendState = BlendState.Opaque;
        device.DepthStencilState = DepthStencilState.DepthRead;
        device.RasterizerState = RasterizerState.CullNone;
        device.SetVertexBuffer(_vb);
        device.Indices = _ib;
        _fx.CurrentTechnique.Passes[0].Apply();
        device.DrawIndexedPrimitives(PrimitiveType.TriangleList, 0, 0, _primitives);
    }

    public void Dispose()
    {
        _vb.Dispose();
        _ib.Dispose();
    }
}
