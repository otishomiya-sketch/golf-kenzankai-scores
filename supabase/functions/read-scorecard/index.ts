// スコアカードの写真から、各選手の18ホールのスコアを読み取る（Supabase Edge Function）
// - 呼べるのはログインした人だけ（会員の共通アカウント・管理者）
// - 写真は保存しない（読み取りに使ったら捨てる）
// - 使いすぎ防止：24時間あたり DAILY_LIMIT 回まで
// 必要な秘密の値：ANTHROPIC_API_KEY（Supabase の Edge Functions → Secrets に登録）
import Anthropic from "npm:@anthropic-ai/sdk@1.4.0";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const ALLOWED_ORIGINS = ["https://otishomiya-sketch.github.io", "http://localhost:8765"];
const DAILY_LIMIT = 150;
const MAX_IMAGE_BASE64 = 7_000_000; // 約5MB
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

// 読み取り結果の形（構造化出力で、この形の JSON だけを返させる）
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_scorecard", "players", "note"],
  properties: {
    is_scorecard: { type: "boolean" },
    note: { type: "string" },
    players: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name_on_card", "roster_match", "holes", "out_total", "in_total", "total"],
        properties: {
          name_on_card: { type: "string" },
          roster_match: { type: "string" },
          holes: { type: "array", items: { type: ["integer", "null"] } },
          out_total: { type: ["integer", "null"] },
          in_total: { type: ["integer", "null"] },
          total: { type: ["integer", "null"] },
        },
      },
    },
  },
};

function prompt(roster: string[]) {
  return `これはゴルフのスコアカード（平取カントリー倶楽部、18ホール、パー72：アウト1〜9番・イン10〜18番、各36）の写真です。
カードに書かれている各プレーヤーについて、次を読み取ってください。

- name_on_card：カードに書かれている名前（読めた通り。読めなければ空文字）
- roster_match：次の名簿の中で、その名前に当てはまる人がいればその表記をそのまま。はっきりしなければ空文字
  名簿：${roster.length ? roster.join("、") : "（なし）"}
- holes：1番から18番まで順に、各ホールの打数（ちょうど18個）。パット数や「5/2」のような併記がある場合は、打数（多い方・先の数字）だけ。読めないホールは null
- out_total・in_total・total：カードに書かれている合計（書かれていなければ null）

注意：
- 推測で数字を埋めないでください。読めない・かすれている場合は null にしてください。
- スコアカードでない写真の場合は is_scorecard を false にし、players は空にしてください。
- note には、読み取りで気になった点（かすれ、訂正の跡、名前が読みにくい等）を日本語で短く書いてください。`;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const cors = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    // ログインしている人か確認（送られてきたトークンで、その人として Supabase に問い合わせる）
    const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, apikey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "ログインしてください" }, 401);

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await supabase.from("ai_reads").select("id", { count: "exact", head: true }).gte("created_at", since);
    if ((count ?? 0) >= DAILY_LIMIT) return json({ error: `読み取りは24時間で${DAILY_LIMIT}回までです。時間をおいて試してください` }, 429);

    const body = await req.json().catch(() => null);
    const image = typeof body?.image === "string" ? body.image : "";
    const mediaType = MEDIA_TYPES.find((m) => m === body?.mediaType);
    const roster = Array.isArray(body?.roster) ? body.roster.filter((s: unknown) => typeof s === "string").slice(0, 80) : [];
    if (!image || !mediaType) return json({ error: "写真が送られていません" }, 400);
    if (image.length > MAX_IMAGE_BASE64) return json({ error: "写真が大きすぎます" }, 413);

    await supabase.from("ai_reads").insert({});

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // 安全のための判定で断られたときは、自動で別のモデルが引き継ぐ
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: prompt(roster) },
        ],
      }],
    });

    if (response.stop_reason === "refusal") return json({ error: "この写真は読み取れませんでした。手で入力してください" }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "読み取りが途中で止まりました。もう一度試してください" }, 502);
    const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const result = JSON.parse(text);
    // 18ホールにそろえる（足りなければ null で埋め、多ければ切る）
    for (const p of result.players ?? []) {
      p.holes = Array.from({ length: 18 }, (_, i) => (Number.isInteger(p.holes?.[i]) ? p.holes[i] : null));
    }
    return json(result);
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      console.error("anthropic", e.status, e.message);
      return json({ error: `AIの呼び出しに失敗しました（${e.status ?? "通信エラー"}）。時間をおいて試してください` }, 502);
    }
    console.error(e);
    return json({ error: "読み取りに失敗しました。手で入力してください" }, 500);
  }
});
