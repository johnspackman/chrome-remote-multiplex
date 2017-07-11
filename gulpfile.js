const gulp = require('gulp');
const sourcemaps = require('gulp-sourcemaps');
const babel = require('gulp-babel');
const concat = require('gulp-concat');
 
gulp.task('default', () => {
    return gulp.src('src/**/*.js')
        .pipe(sourcemaps.init())
        .pipe(babel({
            presets: ['es2015']
        }))
        .on('error', function(err) {
          console.log(err.toString())
          this.emit('end')
        })
        .pipe(sourcemaps.write('.'))
        .pipe(gulp.dest('dist'));
});

gulp.task('watch', function () {
  gulp
    .start('default')
    .watch('src/**/*.js', ['default'])
    .on('error', function(err) {
      console.log(err.toString())
      this.emit('end')
    });
});

