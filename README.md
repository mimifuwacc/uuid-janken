# UUID じゃんけん

UUID v4 で勝負する対面じゃんけん。スマホ1台を2人で挟んで、タップすると「最初は 4 じゃんけん」の掛け声のあと UUID が1文字ずつ開かれ、**大きい方が勝ち**。

🎮 **遊ぶ**: https://uuid-janken.mimifuwa.cc

## 遊び方

1. スマホを2人の間に置く（PC は横長で左右分割になります）
2. 両プレイヤーが自分側をタップして準備
3. 掛け声のあと、それぞれの UUID が開かれていく
4. UUID を比較して大きい方が WIN 🎉 負けた方から共有もできます

## 開発

[Vite+](https://viteplus.dev/)（`vp`）を使っています。

```sh
vp install   # 依存インストール
vp dev       # 開発サーバー起動
```

その他:

```sh
vp check     # フォーマット / Lint / 型チェック
vp test      # テスト
vp build     # 本番ビルド
```

`main` に push すると GitHub Actions で Cloudflare Workers に自動デプロイされます。

## コントリビューション

気軽にどうぞ！Issue も PR も歓迎です。やってくれれば大体見るし、大体入れます 👍

## リンク

- 本番: https://uuid-janken.mimifuwa.cc
- リポジトリ: https://github.com/mimifuwacc/uuid-janken
