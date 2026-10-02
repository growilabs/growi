# Should not be replaced

filter=(FOO), except=(word1|word2|word3)

# Should be replaced

<div class="container-fluid">
    <div class="row">
        <div>
            <div>FOO</div>

$foo(depth=2, filter=FOO)
</div>
        <div>
            <div>BAR</div>

$bar(depth=2, filter=BAR)
</div>
        <div>
            <div>BAZ</div>

$baz(depth=2, filter=BAZ)
</div>
    </div>
    <hr>
    <div class="row">
        <div>
            <div>FOO</div>

$foo(depth=2, filter=FOO, except=word1|word2|word3)
</div>
        <div>
            <div>BAR</div>

$bar(depth=2, filter=BAR, except=word1|word2|word3)
</div>
        <div>
                <div>BAZ</div>

$baz(depth=2, filter=BAZ, except=word1|word2|word3)
</div>
    </div>
</div>
