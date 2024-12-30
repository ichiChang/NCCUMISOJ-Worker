// testTemplates.js
export const testTemplates = {
    python: `
import json
import sys
import traceback
from time import time

def run_tests(test_cases, solution_func):
    results = {
        'total': len(test_cases),
        'passed': 0,
        'failed': 0,
        'execution_time': 0,
        'cases': []
    }
    
    total_start = time()
    
    for i, test_case in enumerate(test_cases, 1):
        case_result = {
            'id': i,
            'status': 'failed',  # default status
            'input': test_case['input'],
            'expected': test_case['expected']
        }
        
        try:
            start_time = time()
            actual = solution_func(*test_case['input'])
            end_time = time()
            
            case_result.update({
                'actual': actual,
                'time': round((end_time - start_time) * 1000, 2),  # ms
                'status': 'passed' if actual == test_case['expected'] else 'failed',
                'error': None
            })
            
            if case_result['status'] == 'passed':
                results['passed'] += 1
            else:
                results['failed'] += 1
                case_result['reason'] = 'Wrong Answer'
                
        except Exception as e:
            results['failed'] += 1
            case_result.update({
                'status': 'error',
                'error': {
                    'type': type(e).__name__,
                    'message': str(e),
                    'traceback': traceback.format_exc()
                }
            })
        
        results['cases'].append(case_result)
        # 即時輸出結果
        print(json.dumps({"type": "test_result", "data": case_result}), flush=True)
    
    results['execution_time'] = round((time() - total_start) * 1000, 2)  # ms
    print(json.dumps({"type": "final_result", "data": results}), flush=True)

if __name__ == '__main__':
    import solution
    test_cases = {{TEST_CASES}}  # 將被替換為實際的測試案例
    run_tests(test_cases, solution.solution)
`,

    javascript: `
const { performance } = require('perf_hooks');

async function runTests(testCases, solutionFunc) {
    const results = {
        total: testCases.length,
        passed: 0,
        failed: 0,
        execution_time: 0,
        cases: []
    };

    const totalStart = performance.now();

    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        const caseResult = {
            id: i + 1,
            status: 'failed',
            input: testCase.input,
            expected: testCase.expected
        };

        try {
            const startTime = performance.now();
            const actual = await solutionFunc(...testCase.input);
            const endTime = performance.now();

            const isEqual = JSON.stringify(actual) === JSON.stringify(testCase.expected);
            
            caseResult.actual = actual;
            caseResult.time = Math.round((endTime - startTime) * 100) / 100;
            caseResult.status = isEqual ? 'passed' : 'failed';
            caseResult.error = null;

            if (isEqual) {
                results.passed++;
            } else {
                results.failed++;
                caseResult.reason = 'Wrong Answer';
            }
        } catch (e) {
            results.failed++;
            caseResult.status = 'error';
            caseResult.error = {
                type: e.name,
                message: e.message,
                stack: e.stack
            };
        }

        results.cases.push(caseResult);
        console.log(JSON.stringify({ type: 'test_result', data: caseResult }));
    }

    results.execution_time = Math.round((performance.now() - totalStart) * 100) / 100;
    console.log(JSON.stringify({ type: 'final_result', data: results }));
}

const solution = require('./solution');
const testCases = {{TEST_CASES}};
runTests(testCases, solution.solution);
`,

    java: `
import java.util.*;
import com.fasterxml.jackson.databind.ObjectMapper;

public class TestRunner {
    static class TestCase {
        public Object[] input;
        public Object expected;
    }

    static class CaseResult {
        public int id;
        public String status = "failed";
        public Object[] input;
        public Object expected;
        public Object actual;
        public double time;
        public String reason;
        public Map<String, String> error;
    }

    static class TestResults {
        public int total;
        public int passed = 0;
        public int failed = 0;
        public double execution_time;
        public List<CaseResult> cases = new ArrayList<>();
    }

    public static void main(String[] args) throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        TestCase[] testCases = {{TEST_CASES}};
        
        TestResults results = new TestResults();
        results.total = testCases.length;
        
        long totalStart = System.nanoTime();
        
        for (int i = 0; i < testCases.length; i++) {
            TestCase testCase = testCases[i];
            CaseResult caseResult = new CaseResult();
            caseResult.id = i + 1;
            caseResult.input = testCase.input;
            caseResult.expected = testCase.expected;
            
            try {
                long start = System.nanoTime();
                Object actual = Solution.solution(testCase.input);
                long end = System.nanoTime();
                
                caseResult.actual = actual;
                caseResult.time = (end - start) / 1_000_000.0; // convert to ms
                
                boolean isEqual = Objects.deepEquals(actual, testCase.expected);
                if (isEqual) {
                    caseResult.status = "passed";
                    results.passed++;
                } else {
                    caseResult.status = "failed";
                    caseResult.reason = "Wrong Answer";
                    results.failed++;
                }
            } catch (Exception e) {
                results.failed++;
                caseResult.status = "error";
                Map<String, String> error = new HashMap<>();
                error.put("type", e.getClass().getName());
                error.put("message", e.getMessage());
                error.put("stackTrace", Arrays.toString(e.getStackTrace()));
                caseResult.error = error;
            }
            
            results.cases.add(caseResult);
            System.out.println(mapper.writeValueAsString(
                Map.of("type", "test_result", "data", caseResult)
            ));
        }
        
        results.execution_time = (System.nanoTime() - totalStart) / 1_000_000.0;
        System.out.println(mapper.writeValueAsString(
            Map.of("type", "final_result", "data", results)
        ));
    }
}
`
};