using BlockedPixelWarriors.Assets;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Rendering;

/// <summary>GPU vertex layouts matching the attributes declared in the .glfx shaders.</summary>
public static class VertexFormats
{
    /// <summary>Lit.glfx a_pos / a_normal / a_uv / a_color (36 bytes, see <see cref="MeshVertex"/>).</summary>
    public static readonly VertexDeclaration Mesh = new(
        new VertexElement(0, VertexElementFormat.Vector3, VertexElementUsage.Position, 0),
        new VertexElement(12, VertexElementFormat.Vector3, VertexElementUsage.Normal, 0),
        new VertexElement(24, VertexElementFormat.Vector2, VertexElementUsage.TextureCoordinate, 0),
        new VertexElement(32, VertexElementFormat.Color, VertexElementUsage.Color, 0));

    /// <summary>Lit.glfx a_i0..a_i3 (matrix rows) + a_icolor (64 bytes, see <see cref="InstanceVertex"/>).</summary>
    public static readonly VertexDeclaration Instance = new(
        new VertexElement(0, VertexElementFormat.Vector3, VertexElementUsage.TextureCoordinate, 1),
        new VertexElement(12, VertexElementFormat.Vector3, VertexElementUsage.TextureCoordinate, 2),
        new VertexElement(24, VertexElementFormat.Vector3, VertexElementUsage.TextureCoordinate, 3),
        new VertexElement(36, VertexElementFormat.Vector3, VertexElementUsage.TextureCoordinate, 4),
        new VertexElement(48, VertexElementFormat.Vector4, VertexElementUsage.TextureCoordinate, 5));

    /// <summary>Billboard.glfx quad corner vertex (60 bytes).</summary>
    public static readonly VertexDeclaration Billboard = new(
        new VertexElement(0, VertexElementFormat.Vector3, VertexElementUsage.Position, 0),
        new VertexElement(12, VertexElementFormat.Vector2, VertexElementUsage.TextureCoordinate, 0),
        new VertexElement(20, VertexElementFormat.Vector3, VertexElementUsage.TextureCoordinate, 1),
        new VertexElement(32, VertexElementFormat.Vector4, VertexElementUsage.TextureCoordinate, 2),
        new VertexElement(48, VertexElementFormat.Vector3, VertexElementUsage.TextureCoordinate, 3));

    /// <summary>Position-only vertex (sky dome, full-screen triangle).</summary>
    public static readonly VertexDeclaration Position = new(
        new VertexElement(0, VertexElementFormat.Vector3, VertexElementUsage.Position, 0));
}

[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential, Pack = 1)]
public struct BillboardVertex
{
    public Microsoft.Xna.Framework.Vector3 Center;
    public Microsoft.Xna.Framework.Vector2 Corner;
    public Microsoft.Xna.Framework.Vector3 Size;
    public Microsoft.Xna.Framework.Vector4 Color;
    public Microsoft.Xna.Framework.Vector3 Dir;
}
