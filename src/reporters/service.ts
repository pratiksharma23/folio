/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs';
import childProcess from 'child_process';
import path from 'path';
import { request } from 'https';
import { EmptyReporter } from '../reporter';
import { Config, Test, Suite, TestResult } from '../types';
import { monotonicTime } from '../util';
import storage, { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { formatFailure, stripAscii } from './base';

export type RunResult = {
  id: string;
  tenantId: string;
  workflowId: string;
  workflowName: string;
  workflowUrl: string;
  repo: string;
  branch: string;
  triggerType: string;
  triggerId: string;
  triggerUrl: string;
  numTotalTestSuites: number;
  numFailedTestSuites: number;
  numSkippedTestSuites: number;
  numPassedTestSuites: number;
  numTotalTests: number;
  numFailedTests: number;
  numSkippedTests: number;
  numPassedTests: number;
  startTime: number;
  endTime: number;
  status: boolean;
  testResults: string[];
}

export interface TestSuiteResult {
  path: string;
  numTotalTests: number;
  numFailedTests: number;
  numSkippedTests: number;
  numPassedTests: number;
  duration: number;
  tests: TestCaseResult[];
}

export interface TestCaseResult {
  name: string;
  status: string;
  duration: number;
  failureMessages: string[];
  artifacts: string[];
}

class ServiceReporter extends EmptyReporter {
  config: Config;
  suite: Suite;
  private readSasToken: string;
  private writeSasToken: string;
  private blobService: BlobServiceClient;
  private containerClient: ContainerClient;
  private startTime: number;
  private endTime: number;
  private totalTestSuites = 0;
  private failedTestSuites = 0;
  private skippedTestSuites = 0;
  private totalTests = 0;
  private failedTests = 0;
  private skippedTests = 0;
  private artifactMap: Map<string, string[]>;

  onBegin(config: Config, suite: Suite) {
    this.config = config;
    this.suite = suite;
    this.writeSasToken = getSasToken("Write");
    this.readSasToken = getSasToken("Read");
    this.startTime = monotonicTime();
    this.blobService = new storage.BlobServiceClient(`${this.writeSasToken}`);
    this.containerClient = this.blobService.getContainerClient(process.env.GITHUB_RUN_ID);
  }

  onTimeout() {
    this.onEnd();
  }

  onTestEnd(test: Test, result: TestResult) {
    super.onTestEnd(test, result);
    const testOutputDir = this._getTestOutputDir(test);
    if (fs.existsSync(testOutputDir)) {
      const files: string[] = getAllFilesFromFolder(testOutputDir);
      const testArtifacts: string[] = [];
      for (const file of files) {
        const relativePath = this._getRelativePath(file);
        this._createBlobInContainer(file, relativePath);
        testArtifacts.push(this._getSasUriForBlob(`${process.env.GITHUB_RUN_ID}/${relativePath}`));
      }
      this.artifactMap.set(this._getTestKey(test), testArtifacts);
    }
  }

  onEnd() {
    this.endTime = monotonicTime();
    this._registerTestResults();
    this._registerRunResult();
  }

  private _getTestOutputDir(test: Test): null | string {
    const testFileName = path.relative(this.config.testDir, test.spec.file);
    const testOutputDir = `${this.config.outputDir}/${testFileName.substring(0, testFileName.length - 8)}/${test.spec.fullTitle().replace(' ', '-')}/${test.variation['browserName']}`;
    return testOutputDir;
  }

  private _registerTestResults() {
    const testSuites: TestSuiteResult[] = [];
    for (const suite of this.suite.suites) {
      testSuites.push(this._getTestSuiteResults(suite));
    }

    const testResultsFile = `${this.config.outputDir}/testResults.json`;
    const testResultsZippedFile = `${this.config.outputDir}/testResults.zip`;
    fs.writeFileSync(testResultsFile, JSON.stringify(testSuites));
    childProcess.execSync(`zip ${this.config.outputDir}/testResults ${testResultsFile}`);
    this._createBlobInContainer(testResultsZippedFile, this._getRelativePath(testResultsZippedFile));
  }

  private _getTestSuiteResults(suite: Suite): TestSuiteResult {
    let tests = 0;
    let skipped = 0;
    let failures = 0;
    let duration = 0;
    const testCases: TestCaseResult[] = [];

    suite.findTest(test => {
      ++tests;
      if (test.skipped)
        ++skipped;
      if (!test.ok())
        ++failures;
      for (const result of test.results)
        duration += result.duration;
      this._addTestCaseResult(test, testCases);
    });
    this.totalTests += tests;
    this.skippedTests += skipped;
    this.failedTests += failures;

    ++this.totalTestSuites;
    if (tests === skipped) {
      ++this.skippedTestSuites;
    } else if (failures !== 0) {
      ++this.failedTestSuites;
    }

    const testSuiteResult: TestSuiteResult = {
      path: suite.file,
      numTotalTests: tests,
      numFailedTests: failures,
      numSkippedTests: skipped,
      numPassedTests: tests - (failures + skipped),
      duration: duration / 1000,
      tests: testCases
    };
    return testSuiteResult;
  }

  private _addTestCaseResult(test: Test, testcases: TestCaseResult[]) {
    let status: string;
    const failureMessages: string[] = [];
    if (test.skipped) {
      status = 'skipped';
    } else if (test.ok()) {
      status = 'passed';
    } else {
      status = 'failed';
      failureMessages.push(stripAscii(formatFailure(this.config, test)));
    }
    let testCase: TestCaseResult = {
      name: test.spec.fullTitle(),
      status: status,
      duration: (test.results.reduce((acc, value) => acc + value.duration, 0)) / 1000,
      failureMessages: failureMessages,
      artifacts: this.artifactMap.get(this._getTestKey(test))
    };
    testcases.push(testCase);
  }

  private _registerRunResult() {
    const runResult: RunResult = {
      id: process.env.GITHUB_RUN_ID,
      tenantId: process.env.TENANT_ID,
      workflowId: process.env.WORKFLOW_ID,
      workflowName: process.env.GITHUB_WORKFLOW,
      workflowUrl: process.env.WORKFLOW_URL,
      repo: process.env.GITHUB_REPOSITORY,
      branch: process.env.BRANCH_NAME,
      triggerType: process.env.TRIGGER_TYPE,
      triggerId: process.env.GITHUB_SHA,
      triggerUrl: process.env.TRIGGER_URL,
      numTotalTestSuites: this.totalTestSuites,
      numFailedTestSuites: this.failedTestSuites,
      numSkippedTestSuites: this.skippedTestSuites,
      numPassedTestSuites: this.totalTestSuites - (this.failedTestSuites + this.skippedTestSuites),
      numTotalTests: this.totalTests,
      numFailedTests: this.failedTests,
      numSkippedTests: this.skippedTests,
      numPassedTests: this.totalTests - (this.failedTests + this.skippedTests),
      startTime: this.startTime,
      endTime: this.endTime,
      status: this.failedTests === 0 ? true : false,
      testResults: this._getTestResultBlobs()
    }
    postRunResult(runResult);
  }

  private _getTestResultBlobs(): string[] {
    let testResultBlobs: string[];
    testResultBlobs.push(this._getSasUriForBlob(`${process.env.GITHUB_RUN_ID}/testResults.zip`));
    return testResultBlobs;
  }

  private _getSasUriForBlob(filePath: string): string {
    let splitted: string[] = this.readSasToken.split('?sv');
    return `${splitted[0]}/${filePath}?sv${splitted[1]}`;
  }

  private async _createBlobInContainer(file: string, blobName: string) {
    const blobClient = this.containerClient.getBlockBlobClient(blobName);
    await blobClient.uploadFile(file);
  }

  private _getTestKey(test: Test): string {
    return `${path.relative(this.config.testDir, test.spec.file)}-${test.spec.fullTitle().replace(' ', '-')}-${test.variation['browserName']}`;
  }

  private _getRelativePath(file: string): string {
    const string = 'test-results/';
    const baseDirIndex = file.indexOf(string);
    return file.substring(baseDirIndex + string.length);
  }
}

function getSasToken(permission: string): null | string {
  let sasToken: string;
  const options = {
    hostname: process.env.ENDPOINT,
    path: `api/${process.env.TENANT_ID}/sasuri?runId=${process.env.GITHUB_RUN_ID}?op=${permission}`,
    method: 'GET'
  }

  const req = request(options, res => {
    res.on('data', d => {
      sasToken = JSON.parse(d).sasUri;
    })
  })

  req.on('error', error => {
    console.error(error)
  })
  req.end()
  return sasToken;
}

function postRunResult(runResult: RunResult) {
  const options = {
    hostname: process.env.ENDPOINT,
    path: `api/${process.env.TENANT_ID}/runs`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': '*/*',
    }
  }

  const req = request(options, res => {
    res.on('data', d => {
      process.stdout.write(d)
    })
  })

  req.on('error', error => {
    console.error(error)
  })
  req.write(JSON.stringify(runResult));
  req.end()
}

function getAllFilesFromFolder(dir: string): string[] {
  let results: string[] = [];

  fs.readdirSync(dir).forEach(function (file) {
    file = dir + '/' + file;
    var stat = fs.statSync(file);

    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFilesFromFolder(file))
    } else results.push(file);

  });
  return results;
}

export default ServiceReporter;
