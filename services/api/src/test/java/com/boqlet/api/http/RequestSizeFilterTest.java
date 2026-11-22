package com.boqlet.api.http;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** TF-174: JSON bodies are capped whether or not they declare their length; uploads keep their own limits. */
class RequestSizeFilterTest {
    private final RequestSizeFilter filter = new RequestSizeFilter(new ObjectMapper());

    @Test
    void aDeclaredLengthOverTheLimitIsRefusedBeforeTheBodyIsRead() throws Exception {
        var request = request("/api/v1/me", "application/json", (int) RequestSizeFilter.DEFAULT_LIMIT + 1, false);
        var response = new MockHttpServletResponse();
        filter.doFilter(request, response, (req, res) -> { throw new AssertionError("the body must not reach the handler"); });
        assertThat(response.getStatus()).isEqualTo(413);
        assertThat(response.getContentAsString()).contains("\"code\":\"too_large\"");
    }

    @Test
    void aChunkedBodyIsCountedWhileItIsRead() {
        var request = request("/api/v1/me", "application/json", (int) RequestSizeFilter.DEFAULT_LIMIT + 1, true);
        FilterChain reader = (req, res) -> req.getInputStream().readAllBytes();
        assertThatThrownBy(() -> filter.doFilter(request, new MockHttpServletResponse(), reader))
                .isInstanceOf(RequestSizeFilter.TooLarge.class);
    }

    @Test
    void documentOperationsAllowLargerBodiesAndUploadsAreLeftToTheirOwnLimits() throws Exception {
        FilterChain reader = (req, res) -> req.getInputStream().readAllBytes();
        var draft = request("/api/v1/presets/0193d8a2-0000-7000-8000-000000000000/draft", "application/json",
                (int) RequestSizeFilter.DEFAULT_LIMIT * 2, true);
        var response = new MockHttpServletResponse();
        filter.doFilter(draft, response, reader);
        assertThat(response.getStatus()).isEqualTo(200);
        var upload = request("/api/v1/codelists/read", "multipart/form-data; boundary=x",
                (int) RequestSizeFilter.DEFAULT_LIMIT * 2, false);
        filter.doFilter(upload, response, reader);
        assertThat(response.getStatus()).isEqualTo(200);
    }

    private static MockHttpServletRequest request(String path, String type, int size, boolean chunked) {
        var request = new MockHttpServletRequest("POST", path) {
            @Override
            public long getContentLengthLong() {
                return chunked ? -1 : super.getContentLengthLong();
            }
        };
        request.setContentType(type);
        request.setContent(new byte[size]);
        return request;
    }
}
