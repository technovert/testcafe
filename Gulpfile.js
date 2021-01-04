/* eslint-disable @typescript-eslint/no-var-requires */
const gulp = require('gulp');
const gulpStep = require('gulp-step');
const data = require('gulp-data');
const less = require('gulp-less');
const mustache = require('gulp-mustache');
const rename = require('gulp-rename');
const uglify = require('gulp-uglify-es').default;
const clone = require('gulp-clone');
const mergeStreams = require('merge-stream');
const del = require('del');
const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');
const { promisify } = require('util');
const globby = require('globby');
const childProcess = require('child_process');
const npmAuditor = require('npm-auditor');

const minimist = require('minimist');

const readFile = promisify(fs.readFile);

gulpStep.install();

const ARGS = minimist(process.argv.slice(2));
const DEV_MODE = 'dev' in ARGS;

const NODE_MODULE_BINS = path.join(__dirname, 'node_modules/.bin');

process.env.PATH =
    NODE_MODULE_BINS +
    path.delimiter +
    process.env.PATH +
    path.delimiter +
    NODE_MODULE_BINS;

function promisifyStream (stream) {
    return new Promise((resolve, reject) => {
        stream.on('end', resolve).on('error', reject);
    });
}

gulp.task('audit', () => {
    return npmAuditor().then((result) => {
        process.stdout.write(result.report);
        process.stdout.write('\n');

        if (result.exitCode !== 0) throw new Error('Security audit failed');
    });
});

gulp.task('clean', () => {
    return del('lib');
});

// Lint
gulp.task('lint', () => {
    const eslint = require('gulp-eslint');

    return gulp
        .src([
            'examples/**/*.js',
            'docker/*.js',
            'src/**/*.js',
            'src/**/*.ts',
            'test/**/*.js',
            '!test/client/vendor/**/*.*',
            '!test/functional/fixtures/api/es-next/custom-client-scripts/data/*.js',
            'Gulpfile.js',
        ])
        .pipe(eslint())
        .pipe(eslint.format(process.env.ESLINT_FORMATTER))
        .pipe(eslint.failAfterError());
});

// Build
const EMPTY_COMMENT_REGEXP = /^\s*\/\/\s*$/gm;
const EMPTY_LINES_REGEXP = /^\s*$/gm;
const NEWLINE_REGEXP = /^/gm;
const IDNENT_SPACE_REGEXP = /^\s*\n(\s*)\S/;
const SPACE = ' ';
const INDENT_SPACE_COUNT = 4;

gulp.step('ts-defs', async () => {
    const partialPaths = await globby('src/ts-defs-src/*/**/*.d.ts');
    const partials = {};

    for (const partialPath of partialPaths) {
        partials[path.basename(partialPath)] = String(
            await readFile(partialPath)
        );
    }

    const stream = gulp
        .src('src/ts-defs-src/*.mustache')
        .pipe(
            mustache(
                {
                    allowReferences: false,

                    format: () => (text, render) => {
                        const renderedText = render(text);

                        const indent = IDNENT_SPACE_REGEXP.exec(text);
                        const indentLength =
                            indent[1].length - INDENT_SPACE_COUNT;

                        return renderedText
                            .replace(NEWLINE_REGEXP, SPACE.repeat(indentLength))
                            .replace(EMPTY_COMMENT_REGEXP, '')
                            .replace(EMPTY_LINES_REGEXP, '');
                    },
                },
                {},
                partials
            )
        )
        .pipe(
            rename((file) => {
                file.extname = '';
            })
        )
        .pipe(gulp.dest('lib/ts-defs'));

    await promisifyStream(stream);
});

gulp.step('client-scripts-bundle', () => {
    return childProcess.spawn('rollup -c', {
        shell: true,
        stdio: 'inherit',
        cwd:   path.join(__dirname, 'src/client'),
    });
});

gulp.step('client-scripts-templates-render', () => {
    const scripts = gulp
        .src([
            'src/client/core/index.js.wrapper.mustache',
            'src/client/ui/index.js.wrapper.mustache',
            'src/client/automation/index.js.wrapper.mustache',
            'src/client/driver/index.js.wrapper.mustache',
        ])
        .pipe(
            rename((file) => {
                file.extname = '';
                file.basename = file.basename.replace('.js.wrapper', '');
            })
        )
        .pipe(
            data((file) => {
                const sourceFilePath = path.resolve(
                    'lib',
                    file.relative + '.js'
                );

                return {
                    source: fs.readFileSync(sourceFilePath),
                };
            })
        )
        .pipe(mustache())
        .pipe(
            rename((file) => {
                file.extname = '.js';
            })
        );

    const bundledScripts = scripts
        .pipe(clone())
        .pipe(uglify())
        .pipe(
            rename((file) => {
                file.extname = '.min.js';
            })
        );

    return mergeStreams(scripts, bundledScripts).pipe(gulp.dest('lib'));
});

gulp.step(
    'client-scripts',
    gulp.series('client-scripts-bundle', 'client-scripts-templates-render')
);

gulp.step('server-scripts-compile', () => {
    return childProcess.spawn('tsc -p src/tsconfig.json', {
        shell: true,
        stdio: 'inherit',
    });
});

gulp.task('sc-comp', () => {
    return childProcess.spawn('tsc -p src/tsconfig.json', {
        shell: true,
        stdio: 'inherit',
    });
});

// TODO: get rid of this step when we migrate to proper ES6 default imports
gulp.step('server-scripts-add-exports', () => {
    const transform = new Transform({
        objectMode: true,

        transform (file, enc, cb) {
            const fileSource = file.contents.toString();

            if (fileSource.indexOf('exports.default =') >= 0) {
                const sourceMapIndex = fileSource.indexOf(
                    '//# sourceMappingURL'
                );
                const modifiedSource =
                    fileSource.slice(0, sourceMapIndex) +
                    'module.exports = exports.default;\n' +
                    fileSource.slice(sourceMapIndex);

                file.contents = Buffer.from(modifiedSource);
            }
            cb(null, file);
        },
    });

    return gulp
        .src(['src/**/*.js', '!src/client/**/*.js'])
        .pipe(transform)
        .pipe(gulp.dest('lib'));
});

gulp.step('server-scripts', gulp.series('server-scripts-compile'));

gulp.step('styles', () => {
    return gulp.src('src/**/*.less').pipe(less()).pipe(gulp.dest('lib/'));
});

gulp.step('templates', () => {
    return gulp
        .src(['src/**/*.mustache', '!src/**/*.js.wrapper.mustache'])
        .pipe(gulp.dest('lib'));
});

gulp.step('images', () => {
    return gulp
        .src(['src/**/*.png', 'src/**/*.ico', 'src/**/*.svg'])
        .pipe(gulp.dest('lib'));
});

gulp.step(
    'package-content',
    gulp.parallel(
        'ts-defs',
        'client-scripts',
        'styles',
        'images',
        'templates',
        'server-scripts'
    )
);

gulp.task('fast-build', gulp.series('clean', 'package-content'));

gulp.task(
    'build',
    DEV_MODE
        ? gulp.registry().get('fast-build')
        : gulp.parallel('lint', 'fast-build')
);
