# Alerts

> [!NOTE]
> Useful information that users should know, even when skimming content.

> [!TIP]
> Helpful advice for doing things better or more easily.

> [!IMPORTANT]
> Key information users need to know to achieve their goal.

> [!WARNING]
> Urgent info that needs immediate user attention to avoid problems.

> [!CAUTION]
> Advises about risks or negative outcomes of certain actions.


```markdown
> [!NOTE]
> Useful information that users should know, even when skimming content.

> [!TIP]
> Helpful advice for doing things better or more easily.

> [!IMPORTANT]
> Key information users need to know to achieve their goal.

> [!WARNING]
> Urgent info that needs immediate user attention to avoid problems.

> [!CAUTION]
> Advises about risks or negative outcomes of certain actions.
```

Vous pouvez également utiliser la [syntaxe de directive](https://talk.commonmark.org/t/generic-directives-plugins-syntax/444).

:::note
Useful information that users should know, even when skimming content.
:::

:::tip[Custom Label]
Useful information that users should know, even when skimming content.
:::

```markdown
:::note
Useful information that users should know, even when skimming content.
:::

:::tip[Custom Label]
Useful information that users should know, even when skimming content.
:::
```


# Autres
## Citations
- Utilisez des expressions entre guillemets en mettant `>` au début du paragraphe
    - Plusieurs citations peuvent être exprimées en utilisant une séquence de caractères `>`
- Des listes et d'autres éléments peuvent être utilisés ensemble dans les citations

#### Exemple
> - Citation
> - Citation
>> Plusieurs citations doivent insérer plus de `>`

```markdown
> - Citation
> - Citation
>> Plusieurs citations doivent insérer plus de `>`
```

# Code
- Il est possible d'exprimer le code en l'ajoutant en trois `` ` ``

#### Exemple

```markdown
Ajoutez des codes ici

Les sauts de ligne et les paragraphes peuvent être reflétés dans le code tel quel
```

#### Exemple (code source)

```javascript:mersenne-twister.js
function MersenneTwister(seed) {
  if (arguments.length == 0) {
    seed = new Date().getTime();
  }

  this._mt = new Array(624);
  this.setSeed(seed);
}
```

## Code en ligne
- Entourez les mots de `` ` `` pour créer du code en ligne

#### Exemple
Voici le `code en ligne`



# Liste des tâches
- Insérer une liste de cases à cocher non cochées en écrivant `[]`
    - Cocher la case à cocher en écrivant `[x]`

#### Exemple
- [ ] Tâche 1
    - [x] Tâche 1-1
    - [ ] Tâche 1-2
- [x] Tâche 2


# Lignes horizontales
- Insérer la ligne horizontale avec trois astérisques consécutifs ou plus `*` ou des traits de soulignement `_`

#### Exemple
Ci-dessous se trouve une ligne horizontale
***

Ci-dessous se trouve une ligne horizontale
___

```markdown
Ci-dessous se trouve une ligne horizontale
***

Ci-dessous se trouve une ligne horizontale
___
```


# Footnotes

You can add footnotes to your content by using this bracket syntax:

Here is a simple footnote[^1].

A footnote can also have multiple lines[^2].

[^1]: My reference.
[^2]: To add line breaks within a footnote, prefix new lines with 2 spaces.
  This is a second line.

```markdown
Here is a simple footnote[^1].

A footnote can also have multiple lines[^2].

[^1]: My reference.
[^2]: To add line breaks within a footnote, prefix new lines with 2 spaces.
  This is a second line.
```


# emoji

Vous pouvez ajouter des emojis à votre texte en tapant le nom de l'emoji après un deux-points `:`.

- :+1: BON!
- :white_check_mark: Vérifié
- :lock: Verrouillé

Lorsque vous tapez deux caractères ou plus après le deux-points, une liste de suggestions d'emojis apparaîtra. Cette liste se réduira au fur et à mesure que vous continuez à taper. Une fois que vous avez trouvé l'emoji que vous recherchez, appuyez sur Tab ou Entrée pour insérer l'emoji sélectionné.

Pour une liste des emojis disponibles, consultez le "[Emoji Cheat Sheet](https://github.com/ikatyang/emoji-cheat-sheet/blob/master/README.md)".


## Tableau

### Syntaxe générale

#### Exemple

| Left align | Right align | Center align |
|:-----------|------------:|:------------:|
| This       | This        | This         |
| column     | column      | column       |
| will       | will        | will         |
| be         | be          | be           |
| left       | right       | center       |
| aligned    | aligned     | aligned      |

```markdown
| Left align | Right align | Center align |
|:-----------|------------:|:------------:|
| This       | This        | This         |
| column     | column      | column       |
| will       | will        | will         |
| be         | be          | be           |
| left       | right       | center       |
| aligned    | aligned     | aligned      |
```

### CSV / TSV

#### Exemple

``` tsv
Cellule de contenu Cellule de contenu
Cellule de contenu Cellule de contenu
```

~~~
``` csv
Cellule de contenu,Cellule de contenu
Cellule de contenu,Cellule de contenu
```
~~~

~~~
``` tsv
Cellule de contenu Cellule de contenu
Cellule de contenu Cellule de contenu
```
~~~

### CSV / TSV (avec en-tête)

#### Exemple

``` tsv-h
Premier en-tête Deuxième en-tête
Cellule de contenu Cellule de contenu
Cellule de contenu Cellule de contenu
```

~~~
``` csv-h
Premier en-tête Deuxième en-tête
Cellule de contenu,Cellule de contenu
Cellule de contenu,Cellule de contenu
```
~~~

~~~
``` tsv-h
Premier en-tête Deuxième en-tête
Cellule de contenu Cellule de contenu
Cellule de contenu Contenu Cellule
```
~~~

