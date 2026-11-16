package com.boqlet.api;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

@AnalyzeClasses(packages = "com.boqlet.api", importOptions = ImportOption.DoNotIncludeTests.class)
class CoreArchitectureTest {
    @ArchTest
    static final ArchRule coreDoesNotDependOnModules = noClasses().that().resideInAPackage("com.boqlet.api..")
            .should().dependOnClassesThat().resideInAnyPackage("com.boqlet.modules..", "com.boqlet.pricing..", "com.boqlet.api.pricing..");
}
