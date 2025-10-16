# Specify the base image (check for the latest tag and specify if preferred)
FROM mcr.microsoft.com/playwright:v1.54.2-noble

# Set working directory (optional)
WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json* ./

# Install @playwright/mcp globally and project dependencies
# RUN npm cache clean --force # Try this if you encounter caching issues
RUN npm install -g @playwright/mcp@0.0.32 && \
    npm install --production

# Install Chrome browser and dependencies required by Playwright
# Although the base image should include them, explicitly install in case MCP cannot find them
RUN npx playwright install chrome && npx playwright install-deps chrome

# Create non-root user for security with proper home directory
RUN addgroup --system playwright && adduser --system --ingroup playwright --home /home/playwright playwright

# Copy application files
COPY entrypoint.sh server.js /app/
RUN chmod +x /app/entrypoint.sh

# Change ownership of /app to playwright user
RUN chown -R playwright:playwright /app

# Set up npm directories for the playwright user
RUN mkdir -p /home/playwright/.npm && chown -R playwright:playwright /home/playwright

# Switch to non-root user
USER playwright

# Set the entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]
