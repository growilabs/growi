# Bienvenue dans le bac à sable GROWI !

> [!NOTE]
> **Qu'est-ce qu'un bac à sable ?**
> 
> Ceci est une page de pratique que vous pouvez éditer librement. C'est l'endroit idéal pour essayer de nouvelles choses !


## :beginner: Pour les débutants

Avec GROWI, vous pouvez facilement créer des pages visuellement attrayantes en utilisant une notation appelée "Markdown".  
En utilisant Markdown, vous pouvez faire des choses comme ça !

- Mettre en évidence du texte avec du **gras** ou de l'*italique*
- Créer des listes à puces ou numérotées
- [Insérer des liens](#-lien)
- Créer des tableaux
- Ajouter des blocs de code

Diverses autres décorations sont également possibles.

## Essayons-le !

1. N'hésitez pas à éditer cette page
1. Il n'y a pas besoin de craindre de faire des erreurs
1. Vous pouvez toujours revenir en arrière sur les modifications
1. Vous pouvez également apprendre des modifications des autres

> [!IMPORTANT]
> **Pour les administrateurs**
> 
> Le bac à sable est un lieu important pour l'apprentissage :
> - Comme première étape pour que les nouveaux membres s'habituent à GROWI
> - Comme terrain de pratique pour Markdown
> - Comme outil de communication au sein de l'équipe
>     - Même si cette page devient encombrée, c'est un signe d'apprentissage actif. Des nettoyages réguliers sont bons, mais il est recommandé de maintenir sa nature d'espace d'expérimentation libre.


# :closed_book: Titres et paragraphes
- En insérant des titres et des paragraphes, vous pouvez rendre le texte de la page plus facile à lire

## En-têtes
- Ajoutez `#` avant le texte du titre pour créer un titre
    - En fonction du nombre de `#`, la taille de la police des titres sera différente de celle affichée dans l'écran d'affichage
- Le nombre de `#` déterminera le niveau de hiérarchie et vous aidera à organiser le contenu

```markdown
# Titre de premier niveau
## Titre de deuxième niveau
### Titre de troisième niveau
#### Titre de quatrième niveau
##### Titre de cinquième niveau
###### Titre de sixième niveau
```

## Saut
- Insérez deux espaces de demi-largeur à la fin de la phrase que vous souhaitez couper
    - Vous pouvez également modifier cela dans le paramètre pour couper la ligne sans demi-largeur espaces
        - Modifiez le paramètre de saut de ligne dans le secteur « Paramètres Markdown » de la page d'administration

#### Exemple : Sans saut de ligne
Paragraphe 1
Paragraphe 2

#### Exemple : Avec saut de ligne
Paragraphe 1  
Paragraphe 2

## Bloc
- Les paragraphes peuvent être créés en insérant une ligne vide dans le texte
- Le passage peut être divisé en phrases et les rendre plus faciles à lire

#### Exemple : Sans paragraphe
Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

#### Exemple : Avec paragraphe
Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.


# :blue_book: Style du texte
- Différents styles peuvent être appliqués pour enrichir l'expression textuelle d'une phrase
    - Ces styles peuvent également être facilement appliqués en sélectionnant l'icône de la barre d'outils en bas de l'écran d'édition

| Style                     | Syntax                 | Keyboard Shortcut | Example                                   | Output                                 |
| ------------------------- | ---------------------- | ----------------- | ----------------------------------------- | -------------------------------------- |
| Bold                      | `** **` or `__ __`     | (TBD)             | `**This is bold text**`                   | **This is bold text**                  |
| Italic                    | `* *` or `_ _`         | (TBD)             | `_This text is italicized_`               | *This text is italicized*              |
| Strikethrough             | `~~ ~~`                | (TBD)             | `~~This was mistaken text~~`             | ~~This was  mistaken text~~            |
| Bold and nested italic | `** **` and `_ _`     | None              | `**This text is _extremely_ important**`  | **This text is _extremely_ important** |
| All Bold and Italic   | `*** ***`              | None              | `***All this text is important***`       | ***All this text is important***      |
| Subscript                 | `<sub> </sub>`         | None              | `This is a <sub>subscript</sub> text`       | This is a <sub>subscript</sub> text      |
| Superscript               | `<sup> </sup>`         | None              | `This is a <sup>superscript</sup> text`     | This is a <sup>superscript</sup> text    |


# :green_book: Insérer des listes
## Liste à puces
- Insérer une liste à puces en commençant une ligne par un trait d'union `-`, un plus `+` ou un astérisque `*`

#### Exemple
- Cette phrase est présente dans la liste à puces
    - Cette phrase est présente dans la liste à puces
        - Cette phrase est présente dans la liste à puces
        - Cette phrase est présente dans la liste à puces
- Cette phrase est présente dans la liste à puces
    - Cette phrase est présente dans la liste à puces

## Liste numérotée
- `Number.` au début d'une ligne pour insérer une liste numérotée
    - Les numéros sont automatiquement attribués

- La liste numérotée et la liste à puces peuvent également être combinées pour être utilisées

#### Exemple
1. Cette phrase est présente dans la liste numérotée
    1. Cette phrase est présente dans la liste numérotée
    1. Cette phrase est présente dans la liste numérotée
    1. Cette phrase est présente dans la liste numérotée
        - Cette phrase est présente dans la liste à puces
1. Cette phrase est présente dans la liste à puces
    - Cette phrase est présente dans la liste à puces


# :ledger: Lien

## Lien automatique
Il suffit d'écrire l'URL et le lien sera généré automatiquement.

### Exemple

https://www.google.co.jp

```markdown
https://www.google.co.jp
```

## Libellé et lien
Insérez un lien en écrivant `[label](URL)`

### Exemple
- [Google](https://www.google.co.jp/)
- [Sandbox est ici](/Sandbox)

```markdown
- [Google](https://www.google.co.jp/)
- [Sandbox est ici](/Sandbox)
```

## Syntaxe de lien flexible

La syntaxe de lien flexible permet d'écrire facilement un lien par chemin de page, un lien de page relatif et un libellé de lien et une URL.

- [[/Sandbox]]
- [[./Math]]
- [[Comment écrire des formules ?>./Math]]

```markdown
- [[/Sandbox]]
- [[./Math]]
- [[Comment écrire des formules ?>./Math]]
```


# :notebook: Autres applications
- [En savoir plus sur Markdown](/Sandbox/Markdown)

- [Décorez davantage votre page (Bootstrap5)](/Sandbox/Bootstrap5)

- [Comment représenter des diagrammes (Diagrams)](/Sandbox/Diagrams)

- [Comment représenter des formules mathématiques (Math)](/Sandbox/Math)