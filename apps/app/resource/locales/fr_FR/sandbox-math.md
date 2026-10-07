# :pencil2: Math

See [KaTeX](https://katex.org/).

## Inline Formula

When $a \ne 0$, there are two solutions to $ax^2 + bx + c = 0$ and they are
  $$x = {-b \pm \sqrt{b^2-4ac} \over 2a}.$$

## The Lorenz Equations

$$
\begin{align}
\dot{x} & = \sigma(y-x) \\
\dot{y} & = \rho x - y - xz \\
\dot{z} & = -\beta z + xy
\end{align}
$$


## The Cauchy-Schwarz Inequality

$$
\left( \sum_{k=1}^n a_k b_k \right)^{\!\!2} \leq
 \left( \sum_{k=1}^n a_k^2 \right) \left( \sum_{k=1}^n b_k^2 \right)
$$

## A Cross Product Formula

$$
\mathbf{V}_1 \times \mathbf{V}_2 =
 \begin{vmatrix}
  \mathbf{i} & \mathbf{j} & \mathbf{k} \\
  \frac{\partial X}{\partial u} & \frac{\partial Y}{\partial u} & 0 \\
  \frac{\partial X}{\partial v} & \frac{\partial Y}{\partial v} & 0 \\
 \end{vmatrix}
$$


## The probability of getting $\left(k\right)$ heads when flipping $\left(n\right)$ coins is:

$$
P(E) = {n \choose k} p^k (1-p)^{ n-k}
$$

## An Identity of Ramanujan

$$
\frac{1}{(\sqrt{\phi \sqrt{5}}-\phi) e^{\frac25 \pi}} =
     1+\frac{e^{-2\pi}} {1+\frac{e^{-4\pi}} {1+\frac{e^{-6\pi}}
      {1+\frac{e^{-8\pi}} {1+\ldots} } } }
$$

## A Rogers-Ramanujan Identity

$$
1 +  \frac{q^2}{(1-q)}+\frac{q^6}{(1-q)(1-q^2)}+\cdots =
    \prod_{j=0}^{\infty}\frac{1}{(1-q^{5j+2})(1-q^{5j+3})},
     \quad\quad \text{for $|q|<1$}.
$$

## Maxwell's Equations

$$
\begin{align}
  \nabla \times \vec{\mathbf{B}} -\, \frac1c\, \frac{\partial\vec{\mathbf{E}}}{\partial t} & = \frac{4\pi}{c}\vec{\mathbf{j}} \\
  \nabla \cdot \vec{\mathbf{E}} & = 4 \pi \rho \\
  \nabla \times \vec{\mathbf{E}}\, +\, \frac1c\, \frac{\partial\vec{\mathbf{B}}}{\partial t} & = \vec{\mathbf{0}} \\
  \nabla \cdot \vec{\mathbf{B}} & = 0
\end{align}
$$
