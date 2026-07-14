# UUID じゃんけん

https://uuid-janken.mimifuwa.cc

## 開発

[Vite+](https://viteplus.dev/)（`vp`）を使っています．

```sh
vp install   # 依存インストール
vp dev       # 開発サーバー起動
```

`vp dev` は静的アセットのみで、`/ws`（オンライン対戦）は動きません。オンライン対戦を含めてローカルで動かすには:

```sh
pnpm preview:wrangler   # ビルドして wrangler dev（Worker + アセット）で起動
```

その他:

```sh
vp check     # フォーマット / Lint / 型チェック
vp test      # テスト
vp build     # 本番ビルド
```

`main` に push すると GitHub Actions で Cloudflare Workers に自動デプロイされます。

## コントリビューション

気軽にどうぞ！Issue も PR も歓迎です．やってくれれば大体見るし，大体マージすると思います．
