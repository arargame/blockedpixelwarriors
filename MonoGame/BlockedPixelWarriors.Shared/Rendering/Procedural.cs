using BlockedPixelWarriors.Assets;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Rendering;

/// <summary>Small runtime-generated meshes (shapes the web build creates in code, not in Blender).</summary>
public static class Procedural
{
    /// <summary>THREE.IcosahedronGeometry(1, detail) with a baked non-uniform scale.</summary>
    public static GpuMesh Icosphere(GraphicsDevice device, string name, int detail, Vector3 scale, RenderMaterial material)
    {
        var t = (1 + MathF.Sqrt(5)) / 2;
        var v = new[]
        {
            new Vector3(-1, t, 0), new Vector3(1, t, 0), new Vector3(-1, -t, 0), new Vector3(1, -t, 0),
            new Vector3(0, -1, t), new Vector3(0, 1, t), new Vector3(0, -1, -t), new Vector3(0, 1, -t),
            new Vector3(t, 0, -1), new Vector3(t, 0, 1), new Vector3(-t, 0, -1), new Vector3(-t, 0, 1),
        };
        int[] f =
        {
            0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
            3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
        };
        var verts = new List<MeshVertex>();
        var cols = detail + 1;
        for (var i = 0; i < f.Length; i += 3)
        {
            Vector3 a = v[f[i]], b = v[f[i + 1]], c = v[f[i + 2]];
            // Subdivide the face into (detail+1)^2 triangles, projected onto the unit sphere.
            Vector3 P(int ii, int jj) => Vector3.Normalize(Vector3.Lerp(Vector3.Lerp(a, c, ii / (float)cols), Vector3.Lerp(b, c, ii / (float)cols), ii == cols ? 0 : jj / (float)(cols - ii)));
            for (var ii = 0; ii < cols; ii++)
            {
                for (var jj = 0; jj < 2 * (cols - ii) - 1; jj++)
                {
                    var k = jj / 2;
                    Vector3 p0, p1, p2;
                    if (jj % 2 == 0)
                    {
                        p0 = P(ii, k + 1);
                        p1 = P(ii + 1, k);
                        p2 = P(ii, k);
                    }
                    else
                    {
                        p0 = P(ii, k + 1);
                        p1 = P(ii + 1, k + 1);
                        p2 = P(ii + 1, k);
                    }
                    foreach (var p in new[] { p0, p1, p2 })
                        verts.Add(new MeshVertex { Position = p * scale, Normal = p, Color = Color.White });
                }
            }
        }
        var indices = Enumerable.Range(0, verts.Count).Select(i => (ushort)i).ToArray();
        var file = MeshFromArrays(verts.ToArray(), indices);
        return GpuMesh.Create(device, name, file, _ => material);
    }

    private static MeshFile MeshFromArrays(MeshVertex[] vertices, ushort[] indices)
    {
        // Reuse the .bpm reader path: one material, one part.
        using var ms = new MemoryStream();
        using (var w = new BinaryWriter(ms, System.Text.Encoding.UTF8, true))
        {
            w.Write(System.Text.Encoding.ASCII.GetBytes("BPM1"));
            var json = System.Text.Encoding.UTF8.GetBytes(
                $"{{\"materials\":[{{\"name\":\"procedural\"}}],\"parts\":[{{\"material\":0,\"vertexStart\":0,\"vertexCount\":{vertices.Length},\"indexStart\":0,\"indexCount\":{indices.Length}}}]}}");
            w.Write(json.Length);
            w.Write(json);
            w.Write(vertices.Length);
            w.Write(System.Runtime.InteropServices.MemoryMarshal.AsBytes(vertices.AsSpan()));
            w.Write(indices.Length);
            w.Write(System.Runtime.InteropServices.MemoryMarshal.AsBytes(indices.AsSpan()));
        }
        ms.Position = 0;
        using var r = new BinaryReader(ms);
        return MeshFile.Read(r);
    }
}
