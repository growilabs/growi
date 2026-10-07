# Bootstrap について
- GROWI では [Bootstrap](https://getbootstrap.jp/docs/5.3/getting-started/introduction/)（Bootstrap5）を活用して文章やテキストの装飾をすることが可能です
- 以下にて紹介する代表的な Bootstrap をそのまま引用し活用していただくことが可能です

# 1. バッジ（Badges）

<span class="badge text-bg-primary">テキスト</span>  

<span class="badge text-bg-secondary">テキスト</span>  

<span class="badge text-bg-success">テキスト</span>  

<span class="badge text-bg-danger">テキスト</span>  

<span class="badge text-bg-warning">テキスト</span>  

<span class="badge text-bg-info">テキスト</span>  

<span class="badge text-bg-light">テキスト</span>  

<span class="badge text-bg-dark">テキスト</span>  

---

#### 活用例

- 入社してすぐにやることリスト
    1. 自己紹介文を記載してください <span class="badge text-bg-danger">必須</span>  
    2. 振込先口座情報を記載してください <span class="badge text-bg-danger">必須</span>  
    3. SNS アカウントを記載してください <span class="badge text-bg-secondary">任意</span>  

---




# 2. アラート（Alerts）

<div class="alert alert-primary" role="alert">
  テキストが入ります
</div>

<div class="alert alert-secondary" role="alert">
  テキストが入ります
</div>

<div class="alert alert-success" role="alert">
  テキストが入ります
</div>

<div class="alert alert-danger" role="alert">
  テキストが入ります
</div>

<div class="alert alert-warning" role="alert">
  テキストが入ります
</div>

<div class="alert alert-info" role="alert">
  テキストが入ります
</div>

<div class="alert alert-light" role="alert">
  テキストが入ります
</div>

<div class="alert alert-dark" role="alert">
  テキストが入ります
</div>

---

#### 活用例

<div class="alert alert-danger" role="alert">
  ※こちらの情報はチーム長以上の役職のメンバー以外は編集しないでください※
</div>

---




# 3. カード（Cards）

<div class="card text-bg-primary mb-3" style="max-width: 50rem;">
  <div class="card-header">見出しが入ります</div>
  <div class="card-body">
    <h5 class="card-title">小見出しが入ります</h5>
    <p class="card-text">テキストが入りますテキストが入りますテキストが入りますテキストが入ります</p>
  </div>
</div>

<div class="card text-bg-secondary mb-3" style="max-width: 45rem;">
  <div class="card-header">見出しが入ります</div>
  <div class="card-body">
    <h5 class="card-title">小見出しが入ります</h5>
    <p class="card-text">テキストが入りますテキストが入りますテキストが入りますテキストが入ります</p>
  </div>
</div>

<div class="card text-bg-success mb-3" style="max-width: 40rem;">
  <div class="card-header">見出しが入ります</div>
  <div class="card-body">
    <h5 class="card-title">小見出しが入ります</h5>
    <p class="card-text">テキストが入りますテキストが入りますテキストが入りますテキストが入ります</p>
  </div>
</div>

<div class="card text-bg-danger mb-3" style="max-width: 35rem;">
  <div class="card-header">見出しが入ります</div>
  <div class="card-body">
    <h5 class="card-title">小見出しが入ります</h5>
    <p class="card-text">テキストが入りますテキストが入りますテキストが入りますテキストが入ります</p>
  </div>
</div>

<div class="card text-bg-warning mb-3" style="max-width: 30rem;">
  <div class="card-header">見出しが入ります</div>
  <div class="card-body">
    <h5 class="card-title">小見出しが入ります</h5>
    <p class="card-text">テキストが入りますテキストが入りますテキストが入りますテキストが入ります</p>
  </div>
</div>

<div class="card text-bg-info mb-3" style="max-width: 25rem;">
  <div class="card-header">見出しが入ります</div>
  <div class="card-body">
    <h5 class="card-title">小見出しが入ります</h5>
    <p class="card-text">テキストが入りますテキストが入りますテキストが入りますテキストが入ります</p>
  </div>
</div>

<div class="card text-bg-light mb-3" style="max-width: 20rem;">
  <div class="card-header">見出しが入ります</div>
  <div class="card-body">
    <h5 class="card-title">小見出しが入ります</h5>
    <p class="card-text">テキストが入りますテキストが入りますテキストが入りますテキストが入ります</p>
  </div>
</div>

<div class="card text-bg-dark mb-3" style="max-width: 15rem;">
  <div class="card-header">見出しが入ります</div>
  <div class="card-body">
    <h5 class="card-title">小見出しが入ります</h5>
    <p class="card-text">テキストが入りますテキストが入りますテキストが入りますテキストが入ります</p>
  </div>
</div>

---

#### 活用例

<div class="card text-bg-warning mb-3" style="max-width: 40rem;">
  <div class="card-header">一口コラム</div>
  <div class="card-body">
    <h5 class="card-title">日本で最初のカレーライスのレシピとは？</h5>
    <p class="card-text">日本で初めてカレーライスの調理法が紹介されたのは、1872年（明治5年）に出版された「西洋料理指南」という本でした。</p>
    <p class="card-text">使用する食材として「ネギ・ショウガ・ニンニク・バター・エビ・タイ・鶏・小麦粉・カレー粉」などが挙げられています。</p>
  </div>
</div>

---




# 4. カラー（Colors）
## テキストカラー
<p class="text-primary">テキストはこちら</p>
<p class="text-warning">テキストはこちら</p>
<p class="text-danger">テキストはこちら</p>

## 背景カラー
<p class="bg-primary">テキストはこちら</p>
<p class="bg-warning">テキストはこちら</p>
<p class="bg-danger">テキストはこちら</p>

## テキスト＆背景カラー
<p class="text-danger bg-primary">テキストはこちら</p>
<p class="text-primary bg-warning">テキストはこちら</p>
<p class="text-warning bg-danger">テキストはこちら</p>

---

#### 活用例

- <p class="text-danger">プロジェクトにアサインされる場合はスタートアップを完了させておきましょう</p>
- <p class="bg-warning">分からないことがあればまとめて質問しましょう</p>

---




# 5. コラプス（Collapse）
- コラプスはコンテンツの 表示 / 非表示 の切り替えの際に活用できます

## コンテンツの表示
<a class="btn btn-primary text-white" data-bs-toggle="collapse" href="#collapse-1">
  コンテンツを表示する
</a>

<div class="collapse" id="collapse-1">
  <div class="card card-body">

- 表示させたいコンテンツの内容が入ります
  - 表示させたいコンテンツの内容が入ります
      
  </div>
</div>


## コンテンツの非表示
<a class="btn btn-secondary text-white" data-bs-toggle="collapse" href="#collapse-2">
  コンテンツを非表示にする
</a>

<div class="collapse show" id="collapse-2">
  <div class="card card-body">

- 非表示にさせたいコンテンツの内容が入ります
  - 非表示にさせたいコンテンツの内容が入ります

  </div>
</div>


#### 活用例
<a class="btn btn-warning text-white" data-bs-toggle="collapse" href="#collapse-3">
  最終順位を確認する！
</a>

<div class="collapse" id="collapse-3">
  <div class="card card-body">

##### 優勝者は **Bさん** です！！

| 対象者 | 点数 | 順位 |
| ------ | ---- | ---- |
| Aさん  | 80pt | 2位  |
| Bさん  | 95pt | 1位  |
| Cさん  | 70pt | 3位  |
      
  </div>
</div>






# 公式ドキュメント
- [バッジの詳細はこちら](https://getbootstrap.jp/docs/5.3/components/badge/)
- [アラートの詳細はこちら](https://getbootstrap.jp/docs/5.3/components/alerts/)
- [カード詳細はこちら](https://getbootstrap.jp/docs/5.3/components/card/)
- [カラーの詳細はこちら](https://getbootstrap.jp/docs/5.3/utilities/colors/)
- [コラプスの詳細はこちら](https://getbootstrap.jp/docs/5.3/components/collapse/)
