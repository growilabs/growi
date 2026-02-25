# ページ遷移とレンダリングのデータフロー

このドキュメントは、GROWIのページ遷移からレンダリングまでのデータフローを解説します。

## 登場人物

1.  **`[[...path]].page.tsx`**: Next.js の動的ルーティングを担うメインコンポーネント。サーバーサイドとクライアントサイドの両方で動作します。
2.  **`useSameRouteNavigation.ts`**: クライアントサイドでのパス変更を検知し、データ取得を**トリガー**するフック。
3.  **`useFetchCurrentPage.ts`**: データ取得と関連する Jotai atom の更新を一元管理するフック。データ取得が本当に必要かどうかの最終判断も担います。
4.  **`useShallowRouting.ts`**: サーバーサイドで正規化されたパスとブラウザのURLを同期させるフック。
5.  **`server-side-props.ts`**: サーバーサイドレンダリング（SSR）時にページデータを取得し、`props` としてページコンポーネントに渡します。

---

## フロー1: サーバーサイドレンダリング（初回アクセス時）

ユーザーがURLに直接アクセスするか、ページをリロードした際のフローです。

1.  **リクエスト受信**: サーバーがユーザーからのリクエスト（例: `/user/username/memo`）を受け取ります。
2.  **`getServerSideProps` の実行**:
    - `server-side-props.ts` の `getServerSidePropsForInitial` が実行されます。
    - `retrievePageData` が呼び出され、パスの正規化（例: `/user/username` → `/user/username/`）が行われ、APIからページデータを取得します。
    - 取得したデータと、正規化後のパス (`currentPathname`) を `props` として `[[...path]].page.tsx` に渡します。
3.  **コンポーネントのレンダリングとJotai Atomの初期化**:
    - `[[...path]].page.tsx` は `props` を受け取り、そのデータで `currentPageDataAtom` などのJotai Atomを初期化します。
    - `PageView` などのコンポーネントがサーバーサイドでレンダリングされます。
4.  **クライアントサイドでのハイドレーションとURL正規化**:
    - レンダリングされたHTMLがブラウザに送信され、Reactがハイドレーションを行います。
    - **`useShallowRouting`** が実行され、ブラウザのURL (`/user/username/memo`) と `props.currentPathname` (`/user/username/memo/`) を比較します。
    - 差異がある場合、`router.replace` を `shallow: true` で実行し、ブラウザのURLをサーバーが認識している正規化後のパスに静かに更新します。

---

## フロー2: クライアントサイドナビゲーション（`<Link>` クリック時）

アプリケーション内でページ間を移動する際のフローです。

1.  **ナビゲーション開始**:
    - ユーザーが `<Link href="/new/page">` をクリックします。
    - Next.js の `useRouter` がURLの変更を検出し、`[[...path]].page.tsx` が再評価されます。
2.  **`useSameRouteNavigation` によるトリガー**:
    - このフックの `useEffect` が `router.asPath` の変更 (`/new/page`) を検知します。
    - **`fetchCurrentPage({ path: '/new/page' })`** を呼び出します。このフックは常にデータ取得を試みます。
3.  **`useFetchCurrentPage` によるデータ取得の判断と実行**:
    - `fetchCurrentPage` 関数が実行されます。
    - **3a. パスの前処理**:
        - まず、引数で渡された `path` をデコードします（例: `encoded%2Fpath` → `encoded/path`）。
        - 次に、パスがパーマリンク形式（例: `/65d4e0a0f7b7b2e5a8652e86`）かどうかを判定します。
    - **3b. 重複取得の防止（ガード節）**:
        - 前処理したパスや、パーマリンクから抽出したページIDが、現在Jotaiで管理されているページのパスやIDと同じでないかチェックします。
        - 同じであれば、APIを叩かずに処理を中断し、現在のページデータを返します。
    - **3c. 読み込み状態開始**: `pageLoadingAtom` を `true` に設定します。
    - **3d. API通信**: `apiv3Get('/page', ...)` を実行してサーバーから新しいページデータを取得します。パラメータには、パス、ページID、リビジョンIDなどが含まれます。
4.  **アトミックな状態更新**:
    - **API成功時**:
        - 関連する **すべてのatomを一度に更新** します (`currentPageDataAtom`, `currentPageEntityIdAtom`, `currentPageEmptyIdAtom`, `pageNotFoundAtom`, `pageLoadingAtom` など)。
        - これにより、中間的な状態（`pageId`が`undefined`になるなど）が発生することなく、データが完全に揃った状態で一度だけ状態が更新されます。
    - **APIエラー時 (例: 404 Not Found)**:
        - `pageErrorAtom` にエラーオブジェクトを設定します。
        - `pageNotFoundAtom` を `true` に設定します。
        - 最後に `pageLoadingAtom` を `false` に設定します。
5.  **`PageView` の最終レンダリング**:
    - `currentPageDataAtom` の更新がトリガーとなり、`PageView` コンポーネントが新しいデータで再レンダリングされます。
6.  **副作用の実行**:
    - `useSameRouteNavigation` 内で `fetchCurrentPage` が完了した後、`mutateEditingMarkdown` が呼び出され、エディタの状態が更新されます。
