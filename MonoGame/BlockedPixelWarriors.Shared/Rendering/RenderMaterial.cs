using BlockedPixelWarriors.Assets;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Rendering;

public enum BlendMode { Opaque, Alpha, Additive }

/// <summary>
/// GPU-ready material: the exported Three.js material with its textures resolved and its
/// render states chosen (blend, cull, depth write). Immutable apart from the colour tweaks that
/// gameplay applies (block colours, shield pulse) through <see cref="DrawOverrides"/>.
/// </summary>
public sealed class RenderMaterial
{
    public string Name;
    public Vector4 BaseColor = Vector4.One;
    public Vector3 Emissive;
    public float Roughness = 1, Metalness, EnvIntensity = 1, AlphaTest;
    public bool Unlit, VertexColors, DoubleSided, DepthWrite = true, ToneMapped = true;
    public BlendMode Blend;
    public Texture2D Map;
    public bool MapSrgb = true;
    public Texture2D NormalMap;
    public Vector2 NormalScale = Vector2.One;
    public bool EmissiveUsesMap;
    public Vector4 Voxel; // size, jitter, seam, enabled
    public TileData Tile;
    public float ScrollV;
    /// <summary>Whether geometry with this material is drawn into the sun's shadow map.</summary>
    public bool CastShadow = true;
    public bool Transparent => Blend != BlendMode.Opaque;

    public static RenderMaterial From(MaterialData m, AssetStore assets, Func<string, bool> isSrgb)
    {
        var r = new RenderMaterial
        {
            Name = m.Name,
            Unlit = m.Type == "basic",
            VertexColors = m.VertexColors,
            DoubleSided = m.Side == 2,
            DepthWrite = m.DepthWrite,
            ToneMapped = m.ToneMapped,
            Roughness = m.Roughness,
            Metalness = m.Metalness,
            EnvIntensity = m.EnvMapIntensity,
            AlphaTest = m.AlphaTest,
            Map = assets.Texture(m.Map),
            MapSrgb = m.Map == null || isSrgb(m.Map),
            NormalMap = assets.Texture(m.NormalMap),
            NormalScale = m.NormalScale is { Length: >= 2 } ns ? new Vector2(ns[0], ns[1]) : Vector2.One,
            EmissiveUsesMap = m.EmissiveMap != null,
            Tile = m.Tile,
            ScrollV = m.ScrollV,
        };
        var c = m.Color ?? new[] { 1f, 1f, 1f };
        r.BaseColor = new Vector4(c[0], c[1], c[2], m.Opacity);
        if (m.Emissive is { Length: >= 3 } e) r.Emissive = new Vector3(e[0], e[1], e[2]);
        if (m.Voxel != null) r.Voxel = new Vector4(m.Voxel.Size, m.Voxel.Jitter, m.Voxel.Seam, 1);
        r.Blend = m.Additive ? BlendMode.Additive : m.Transparent && m.AlphaTest <= 0 ? BlendMode.Alpha : BlendMode.Opaque;
        // Alpha-tested materials are cut out in the opaque pass (Three draws them with blending
        // too, but with a hard alpha the result is the same and the depth buffer stays correct).
        if (m.Transparent && m.AlphaTest > 0) r.Blend = BlendMode.Opaque;
        r.CastShadow = r.Blend == BlendMode.Opaque && r.AlphaTest <= 0 && !r.Unlit;
        return r;
    }

    public RenderMaterial Clone() => (RenderMaterial)MemberwiseClone();
}

/// <summary>Per-draw tweaks on top of a material (instancing and tinting without new materials).</summary>
public struct DrawOverrides
{
    /// <summary>Multiplies the material's base colour (rgb) and opacity (a).</summary>
    public Vector4 ColorMul;
    /// <summary>Added to the material's emissive colour.</summary>
    public Vector3 EmissiveAdd;
    /// <summary>Replaces the material's base colour when non-null (block colours).</summary>
    public Vector4? BaseColor;

    public static readonly DrawOverrides None = new() { ColorMul = Vector4.One };
}
