exports["default"] = function () {
  return {
    noColors: true,
    currentFixture: null,

    report: {
      startTime: null,
      endTime: null,
      userAgents: null,
      passed: 0,
      total: 0,
      skipped: 0,
      fixtures: [],
      warnings: [],
    },

    reportTaskStart: function reportTaskStart(
      startTime,
      userAgents,
      testCount
    ) {
      this.report.startTime = startTime;
      this.report.userAgents = userAgents;
      this.report.total = testCount;
    },

    reportFixtureStart: function reportFixtureStart(name, path, meta) {
      this.currentFixture = { name: name, path: path, meta: meta, tests: [] };
      this.report.fixtures.push(this.currentFixture);
    },

    reportTestDone: function reportTestDone(name, testRunInfo, meta) {
      var _this = this;

      var errs = testRunInfo.errs.map(function (err) {
        return _this.formatError(err);
      });

      let errors = errs.map(function (error, i) {
        let scriptStartindex = error.indexOf(".maximizeWindow()");
        let errorActionIndex = 0;
        scriptStartindex = scriptStartindex + ".maximizeWindow()".length;
        for (let i = scriptStartindex; i <= error.length; i++) {
          if (
            error[i] === ">" &&
            (error[i + 5] === "|" || error[i + 4] === "|")
          ) {
            let tempIndex = error.indexOf("ReadyTest", i);
            let actionIndex = tempIndex + "ReadyTest".length;
            errorActionIndex = parseInt(
              error.substring(actionIndex, actionIndex + 2).trim()
            );
            break;
          }
        }
        return {
          message:
            [error.split("\n")[0], error.split("\n")[2]].join("\n\n") + "\n",
          actionIndex: errorActionIndex,
        };
      });

      if (testRunInfo.skipped) this.report.skipped++;

      this.currentFixture.tests.push({
        name: name,
        meta: meta,
        errs: errors,

        durationMs: testRunInfo.durationMs,
        unstable: testRunInfo.unstable,
        screenshotPath: testRunInfo.screenshotPath,
        skipped: testRunInfo.skipped,
      });
    },

    reportTaskDone: function reportTaskDone(endTime, passed, warnings) {
      this.report.passed = passed;
      this.report.endTime = endTime;
      this.report.warnings = warnings;

      this.write(JSON.stringify(this.report, null, 2));
    },
  };
};

module.exports = exports["default"];
