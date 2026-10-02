# :pencil2: 수학 (Math)

[KaTeX](https://katex.org/)를 참조하세요.

## 인라인 수식 (Inline Formula)

$a 
e 0$일 때, $ax^2 + bx + c = 0$에 대한 두 가지 해는 다음과 같습니다.
  $$x = {-b \pm \sqrt{b^2-4ac} \over 2a}.$$

## 로렌츠 방정식 (The Lorenz Equations)

$$
\begin{align}
\dot{x} & = \sigma(y-x) \\
\dot{y} & = \rho x - y - xz \\
\dot{z} & = -\beta z + xy
\end{align}
$$


## 코시-슈바르츠 부등식 (The Cauchy-Schwarz Inequality)

$$
\left( \sum_{k=1}^n a_k b_k \right)^{\!\!2} \leq
 \left( \sum_{k=1}^n a_k^2 \right) \left( \sum_{k=1}^n b_k^2 \right)
$$

## 벡터 곱 공식 (A Cross Product Formula)

$$
\mathbf{V}_1 \times \mathbf{V}_2 =
 \begin{vmatrix}
  \mathbf{i} & \mathbf{j} & \mathbf{k} \\
  \frac{\partial X}{\partial u} & \frac{\partial Y}{\partial u} & 0 \\
  \frac{\partial X}{\partial v} & \frac{\partial Y}{\partial v} & 0 \\
 \end{vmatrix}
$$


## 동전 $\left(n\right)$개를 던져 앞면이 $\left(k\right)$번 나올 확률은 다음과 같습니다:

$$
P(E) = {n \choose k} p^k (1-p)^{ n-k}
$$

## 라마누잔의 항등식 (An Identity of Ramanujan)

$$
\frac{1}{(\sqrt{\phi \sqrt{5}}-\phi) e^{\frac25 \pi}} =
     1+\frac{e^{-2\pi}} {1+\frac{e^{-4\pi}} {1+\frac{e^{-6\pi}}
      {1+\frac{e^{-8\pi}} {1+\ldots} } } }
$$

## 로저스-라마누잔 항등식 (A Rogers-Ramanujan Identity)

$$
1 +  \frac{q^2}{(1-q)}+\frac{q^6}{(1-q)(1-q^2)}+\cdots =
    \prod_{j=0}^{\infty}\frac{1}{(1-q^{5j+2})(1-q^{5j+3})},
     \quad\quad \text{for $|q|<1$}.
$$

## 맥스웰 방정식 (Maxwell's Equations)

$$
\begin{align}
  \nabla \times \vec{\mathbf{B}} -\, \frac1c\, \frac{\partial\vec{\mathbf{E}}}{\partial t} & = \frac{4\pi}{c}\vec{\mathbf{j}} \\
  \nabla \cdot \vec{\mathbf{E}} & = 4 \pi \rho \\
  \nabla \times \vec{\mathbf{E}}\, +\, \frac1c\, \frac{\partial\vec{\mathbf{B}}}{\partial t} & = \vec{\mathbf{0}} \\
  \nabla \cdot \vec{\mathbf{B}} & = 0
\end{align}
$$