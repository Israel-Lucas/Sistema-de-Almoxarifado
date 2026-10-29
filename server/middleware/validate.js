function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Revise os campos destacados e tente novamente.",
        fields,
        details: fields,
      });
    }
    req.validatedBody = result.data;
    next();
  };
}

module.exports = validate;
