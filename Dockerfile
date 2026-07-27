FROM php:8.2-apache

# Install cURL and other system libraries required
RUN apt-get update && apt-get install -y \
    libcurl4-openssl-dev \
    zip \
    unzip \
    && docker-php-ext-install curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Enable Apache rewrite module
RUN a2enmod rewrite

# Copy our optimized php.ini configurations
COPY optimized.ini /usr/local/etc/php/conf.d/optimized.ini

# Copy all project files into Apache root directory
COPY . /var/www/html/

# Ensure write permissions for our JSON flat-file databases
RUN chmod -R 777 /var/www/html/data

# Optimize Apache MPM Prefork settings for 1GB RAM to prevent memory exhaustion
RUN echo '<IfModule mpm_prefork_module>\n\
    StartServers             2\n\
    MinSpareServers          2\n\
    MaxSpareServers          5\n\
    MaxRequestWorkers       30\n\
    MaxConnectionsPerChild   1000\n\
</IfModule>' >> /etc/apache2/apache2.conf

# Port binding fix for Railway's dynamic $PORT assignment
RUN sed -i 's/Listen 80/Listen ${PORT}/g' /etc/apache2/ports.conf
RUN sed -i 's/<VirtualHost \*:80>/<VirtualHost *:${PORT}>/g' /etc/apache2/sites-available/000-default.conf

# Expose the default Apache port
EXPOSE 80

CMD ["apache2-foreground"]
