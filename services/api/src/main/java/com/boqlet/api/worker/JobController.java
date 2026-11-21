package com.boqlet.api.worker;

import com.boqlet.api.identity.Login;
import com.boqlet.contract.api.JobsApi;
import com.boqlet.contract.model.Job;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
class JobController implements JobsApi {
    private final Jobs jobs;

    JobController(Jobs jobs) {
        this.jobs = jobs;
    }

    @Override
    public ResponseEntity<Job> getJob(UUID job) {
        return ResponseEntity.ok(jobs.get(job, Login.current().userId()));
    }

    @Override
    public ResponseEntity<Job> cancelJob(UUID job) {
        return ResponseEntity.ok(jobs.cancel(job, Login.current().userId()));
    }
}
